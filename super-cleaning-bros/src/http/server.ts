import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { AppError, isAppError, isRecord } from "../domain/errors.ts";
import { ghlConfigured } from "../config.ts";
import { parseRangeStart } from "../domain/time.ts";
import { secretsMatch } from "../auth/secrets.ts";
import {
  clearSessionCookie,
  openSession,
  readCookie,
  sealSession,
  sessionCookie,
  type Session,
} from "../auth/session.ts";
import type { Actor } from "../app/actors.ts";
import type { Ctx } from "../app/context.ts";
import { createTechnician, listTechnicians, loginTechnician } from "../app/crew.ts";
import {
  addAddress,
  getCustomerProfile,
  listCustomerViews,
  parseCustomerBody,
  saveCustomer,
  updateCustomer,
} from "../app/customers.ts";
import { acceptEstimate, createEstimate, declineEstimate, listEstimates } from "../app/estimates.ts";
import { addNote, addPhoto, createJob, decideChangeOrder, editNote, getJob, listJobs, listUnscheduled, readPhoto, sendJobMessage, updateJob, updateJobPrice } from "../app/jobs.ts";
import { listTemplates, saveTemplates } from "../app/notify.ts";
import { shareDocument, sharePhoto } from "./share.ts";
import { chargeInvoice, createCardSetup, createInvoice, handleStripeWebhook, saveCard } from "../app/billing.ts";
import { businessReport } from "../app/reports.ts";
import { importCustomers } from "../app/importer.ts";
import { handleGhlWebhook } from "../ghl/inbound.ts";

const publicDir = fileURLToPath(new URL("../../public/", import.meta.url));
const staticFiles: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/app.js": "app.js",
  "/favicon.svg": "favicon.svg",
};

type Route = {
  method: string;
  pattern: RegExp;
  access: "public" | "office" | "crew";
  handler: (ctx: Ctx, req: IncomingMessage, res: ServerResponse, params: string[], body: unknown, raw: Buffer, actor: Actor) => Promise<void>;
};

const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/health$/, access: "public", handler: health },
  { method: "GET", pattern: /^\/api\/session$/, access: "public", handler: session },
  { method: "POST", pattern: /^\/api\/login$/, access: "public", handler: login },
  { method: "POST", pattern: /^\/api\/logout$/, access: "public", handler: logout },
  { method: "POST", pattern: /^\/api\/webhooks\/ghl$/, access: "public", handler: ghlWebhook },
  { method: "POST", pattern: /^\/api\/webhooks\/stripe$/, access: "public", handler: stripeWebhook },
  { method: "GET", pattern: /^\/api\/technicians$/, access: "office", handler: async (ctx, _req, res, _params, _body, _raw, actor) => sendJson(res, 200, { technicians: listTechnicians(ctx, actor) }) },
  { method: "POST", pattern: /^\/api\/technicians$/, access: "office", handler: async (ctx, _req, res, _params, body, _raw, actor) => sendJson(res, 201, { technician: createTechnician(ctx, actor, body) }) },
  { method: "GET", pattern: /^\/api\/customers$/, access: "office", handler: async (ctx, req, res, _params, _body, _raw, actor) => sendJson(res, 200, { customers: listCustomerViews(ctx, actor, query(req, "q")) }) },
  { method: "POST", pattern: /^\/api\/customers$/, access: "office", handler: async (ctx, _req, res, _params, body, _raw, actor) => sendJson(res, 201, await saveCustomer(ctx, actor, parseCustomerBody(body, true), { sync: true })) },
  { method: "GET", pattern: /^\/api\/customers\/([^/]+)$/, access: "office", handler: async (ctx, _req, res, params, _body, _raw, actor) => sendJson(res, 200, getCustomerProfile(ctx, actor, params[0] ?? "")) },
  { method: "PATCH", pattern: /^\/api\/customers\/([^/]+)$/, access: "office", handler: async (ctx, _req, res, params, body, _raw, actor) => sendJson(res, 200, await updateCustomer(ctx, actor, params[0] ?? "", body)) },
  { method: "POST", pattern: /^\/api\/customers\/([^/]+)\/addresses$/, access: "office", handler: async (ctx, _req, res, params, body, _raw, actor) => sendJson(res, 201, { address: await addAddress(ctx, actor, params[0] ?? "", body) }) },
  { method: "PUT", pattern: /^\/api\/customers\/([^/]+)\/card$/, access: "office", handler: async (ctx, _req, res, params, body, _raw, actor) => sendJson(res, 200, { card: saveCard(ctx, actor, params[0] ?? "", body) }) },
  { method: "POST", pattern: /^\/api\/customers\/([^/]+)\/card-setup$/, access: "office", handler: async (ctx, _req, res, params, _body, _raw, actor) => sendJson(res, 200, await createCardSetup(ctx, actor, params[0] ?? "")) },
  { method: "GET", pattern: /^\/api\/estimates$/, access: "office", handler: async (ctx, _req, res, _params, _body, _raw, actor) => sendJson(res, 200, { estimates: listEstimates(ctx, actor) }) },
  { method: "POST", pattern: /^\/api\/estimates$/, access: "office", handler: async (ctx, _req, res, _params, body, _raw, actor) => sendJson(res, 201, { estimate: await createEstimate(ctx, actor, body) }) },
  { method: "POST", pattern: /^\/api\/estimates\/([^/]+)\/accept$/, access: "office", handler: async (ctx, _req, res, params, _body, _raw, actor) => sendJson(res, 200, { estimate: acceptEstimate(ctx, actor, params[0] ?? "") }) },
  { method: "POST", pattern: /^\/api\/estimates\/([^/]+)\/decline$/, access: "office", handler: async (ctx, _req, res, params, _body, _raw, actor) => sendJson(res, 200, { estimate: declineEstimate(ctx, actor, params[0] ?? "") }) },
  { method: "GET", pattern: /^\/api\/jobs$/, access: "crew", handler: jobsList },
  { method: "POST", pattern: /^\/api\/jobs$/, access: "office", handler: async (ctx, _req, res, _params, body, _raw, actor) => sendJson(res, 201, await createJob(ctx, actor, body)) },
  { method: "GET", pattern: /^\/api\/jobs\/([^/]+)$/, access: "crew", handler: async (ctx, _req, res, params, _body, _raw, actor) => sendJson(res, 200, getJob(ctx, actor, params[0] ?? "")) },
  { method: "PATCH", pattern: /^\/api\/jobs\/([^/]+)$/, access: "crew", handler: async (ctx, _req, res, params, body, _raw, actor) => sendJson(res, 200, await updateJob(ctx, actor, params[0] ?? "", body)) },
  { method: "PATCH", pattern: /^\/api\/jobs\/([^/]+)\/price$/, access: "crew", handler: async (ctx, _req, res, params, body, _raw, actor) => sendJson(res, 200, updateJobPrice(ctx, actor, params[0] ?? "", body)) },
  { method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/change-orders\/([^/]+)\/approve$/, access: "office", handler: async (ctx, _req, res, params, _body, _raw, actor) => sendJson(res, 200, decideChangeOrder(ctx, actor, params[0] ?? "", params[1] ?? "", "approved")) },
  { method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/change-orders\/([^/]+)\/reject$/, access: "office", handler: async (ctx, _req, res, params, _body, _raw, actor) => sendJson(res, 200, decideChangeOrder(ctx, actor, params[0] ?? "", params[1] ?? "", "rejected")) },
  { method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/notes$/, access: "crew", handler: async (ctx, _req, res, params, body, _raw, actor) => sendJson(res, 201, { note: addNote(ctx, actor, params[0] ?? "", body) }) },
  { method: "PATCH", pattern: /^\/api\/jobs\/([^/]+)\/notes\/([^/]+)$/, access: "crew", handler: async (ctx, _req, res, params, body, _raw, actor) => sendJson(res, 200, { note: editNote(ctx, actor, params[0] ?? "", params[1] ?? "", body) }) },
  { method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/messages$/, access: "crew", handler: async (ctx, _req, res, params, body, _raw, actor) => sendJson(res, 201, { message: await sendJobMessage(ctx, actor, params[0] ?? "", body) }) },
  { method: "GET", pattern: /^\/api\/message-templates$/, access: "office", handler: async (ctx, _req, res) => sendJson(res, 200, { templates: listTemplates(ctx) }) },
  { method: "PUT", pattern: /^\/api\/message-templates$/, access: "office", handler: async (ctx, _req, res, _params, body) => sendJson(res, 200, { templates: saveTemplates(ctx, body) }) },
  { method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/photos$/, access: "crew", handler: async (ctx, _req, res, params, body, _raw, actor) => sendJson(res, 201, { photo: await addPhoto(ctx, actor, params[0] ?? "", body) }) },
  { method: "GET", pattern: /^\/api\/jobs\/([^/]+)\/photos\/([^/]+)$/, access: "crew", handler: photo },
  { method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/invoice$/, access: "office", handler: async (ctx, _req, res, params, _body, _raw, actor) => sendJson(res, 201, await createInvoice(ctx, actor, params[0] ?? "")) },
  { method: "POST", pattern: /^\/api\/invoices\/([^/]+)\/charge$/, access: "office", handler: async (ctx, _req, res, params, _body, _raw, actor) => sendJson(res, 200, await chargeInvoice(ctx, actor, params[0] ?? "")) },
  { method: "GET", pattern: /^\/api\/reports$/, access: "office", handler: report },
  { method: "POST", pattern: /^\/api\/import\/customers$/, access: "office", handler: importer },
  { method: "GET", pattern: /^\/api\/ghl\/events$/, access: "office", handler: async (ctx, _req, res) => sendJson(res, 200, { events: ctx.store.listEvents() }) },
];

export function createHttpServer(ctx: Ctx) {
  return createServer((req, res) => {
    void dispatch(ctx, req, res).catch((error: unknown) => {
      if (isAppError(error)) {
        sendJson(res, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      console.error(error);
      sendJson(res, 500, { error: { code: "internal", message: "Something went wrong." } });
    });
  });
}

async function dispatch(ctx: Ctx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  if (method === "GET" && url.pathname.startsWith("/share/")) {
    await serveShare(ctx, res, url.pathname);
    return;
  }
  if (method === "GET" && !url.pathname.startsWith("/api/")) {
    await serveStatic(res, url.pathname);
    return;
  }
  const route = routes.find((candidate) => candidate.method === method && candidate.pattern.test(url.pathname));
  if (!route) {
    sendJson(res, 404, { error: { code: "not_found", message: "That page is not in the app." } });
    return;
  }
  const actor = resolveActor(ctx, req);
  if (route.access !== "public") {
    if (!actor) throw new AppError("sign_in_required", "Sign in to continue.", 401);
    if (route.access === "office" && actor.role === "technician") {
      throw new AppError("forbidden", "Office access is required.", 403);
    }
  }
  const limit = url.pathname.endsWith("/photos") || url.pathname.endsWith("/customers") ? 8_000_000 : 1_000_000;
  const raw = method === "GET" ? Buffer.alloc(0) : await readBuffer(req, limit);
  const body = raw.length === 0 ? {} : parseJson(raw, url.pathname);
  const params = route.pattern.exec(url.pathname)?.slice(1) ?? [];
  await route.handler(ctx, req, res, params, body, raw, actor ?? { role: "office", name: "Office" });
}

function health(ctx: Ctx, _req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, {
    ok: true,
    product: "super-cleaning-bros",
    shopPostalCode: ctx.config.shop.postalCode,
    authRequired: ctx.config.auth.required,
    ghlConfigured: ghlConfigured(ctx.config),
    payments: ctx.payments.name,
  });
  return Promise.resolve();
}

function session(ctx: Ctx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const actor = resolveActor(ctx, req);
  sendJson(res, 200, {
    authRequired: ctx.config.auth.required,
    session: actor
      ? {
          role: actor.role,
          name: actor.name,
          technicianId: actor.role === "technician" ? actor.technicianId : null,
        }
      : null,
  });
  return Promise.resolve();
}

function login(ctx: Ctx, _req: IncomingMessage, res: ServerResponse, _params: string[], body: unknown): Promise<void> {
  if (!ctx.config.auth.required) {
    sendJson(res, 200, { role: "office", name: "Office", technicianId: null });
    return Promise.resolve();
  }
  const password = isRecord(body) && typeof body.password === "string" ? body.password : "";
  const name = isRecord(body) && typeof body.name === "string" ? body.name : "";
  const pin = isRecord(body) && typeof body.pin === "string" ? body.pin : "";
  let actor: Actor | null = null;
  if (password && ctx.config.auth.officePassword && secretsMatch(password, ctx.config.auth.officePassword)) {
    actor = { role: "office", name: "Office" };
  } else if (!password && name && pin) {
    actor = loginTechnician(ctx, name, pin);
  }
  if (!actor || actor.role === "system") {
    throw new AppError("invalid_login", "Those sign-in details do not match.", 401);
  }
  const sealed: Session = {
    role: actor.role,
    technicianId: actor.role === "technician" ? actor.technicianId : null,
    name: actor.name,
    exp: Date.now() + 14 * 60 * 60 * 1000,
  };
  res.setHeader(
    "set-cookie",
    sessionCookie(sealSession(sealed, ctx.config.auth.sessionSecret ?? ""), ctx.config.auth.secureCookies, 14 * 60 * 60),
  );
  sendJson(res, 200, sealed);
  return Promise.resolve();
}

function logout(ctx: Ctx, _req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("set-cookie", clearSessionCookie(ctx.config.auth.secureCookies));
  sendJson(res, 200, { ok: true });
  return Promise.resolve();
}

async function ghlWebhook(ctx: Ctx, req: IncomingMessage, res: ServerResponse, _params: string[], body: unknown): Promise<void> {
  const provided = header(req, "x-scb-webhook-secret") ?? header(req, "x-webhook-secret");
  if (!ctx.config.ghl.webhookSecret) {
    throw new AppError("ghl_not_configured", "Set GHL_WEBHOOK_SECRET before receiving GoHighLevel webhooks.", 503);
  }
  if (!secretsMatch(provided, ctx.config.ghl.webhookSecret)) {
    throw new AppError("invalid_signature", "Webhook secret did not match.", 401);
  }
  sendJson(res, 200, await handleGhlWebhook(ctx, body, header(req, "x-ghl-webhook-id")));
}

async function stripeWebhook(ctx: Ctx, req: IncomingMessage, res: ServerResponse, _params: string[], _body: unknown, raw: Buffer): Promise<void> {
  sendJson(res, 200, await handleStripeWebhook(ctx, raw.toString("utf8"), header(req, "stripe-signature")));
}

async function jobsList(ctx: Ctx, req: IncomingMessage, res: ServerResponse, _params: string[], _body: unknown, _raw: Buffer, actor: Actor): Promise<void> {
  if (query(req, "unscheduled") === "1") {
    sendJson(res, 200, { jobs: listUnscheduled(ctx, actor) });
    return;
  }
  const from = parseRangeStart(query(req, "from"), "From");
  const to = parseRangeStart(query(req, "to"), "To");
  sendJson(res, 200, { jobs: listJobs(ctx, actor, from, to) });
}

async function serveShare(ctx: Ctx, res: ServerResponse, pathname: string): Promise<void> {
  const photoMatch = /^\/share\/([^/]+)\/photos\/([^/]+)$/.exec(pathname);
  if (photoMatch) {
    const file = sharePhoto(ctx, decodeURIComponent(photoMatch[1] ?? ""), decodeURIComponent(photoMatch[2] ?? ""));
    if (!file.bytes || !file.contentType) {
      sendJson(res, 404, { error: { code: "not_found", message: "Photo not found." } });
      return;
    }
    res.writeHead(200, { "content-type": file.contentType, "cache-control": "private, max-age=3600", "content-length": file.bytes.byteLength });
    res.end(file.bytes);
    return;
  }
  const pageMatch = /^\/share\/([^/]+)$/.exec(pathname);
  if (!pageMatch) {
    sendJson(res, 404, { error: { code: "not_found", message: "That page is not in the app." } });
    return;
  }
  const page = shareDocument(ctx, decodeURIComponent(pageMatch[1] ?? ""));
  if (!page.html) {
    sendJson(res, 404, { error: { code: "not_found", message: "That photo page was not found." } });
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" });
  res.end(page.html);
}

async function photo(ctx: Ctx, _req: IncomingMessage, res: ServerResponse, params: string[], _body: unknown, _raw: Buffer, actor: Actor): Promise<void> {
  const file = readPhoto(ctx, actor, params[0] ?? "", params[1] ?? "");
  res.writeHead(200, {
    "content-type": file.meta.contentType,
    "cache-control": "private, max-age=3600",
    "content-length": file.bytes.byteLength,
  });
  res.end(file.bytes);
}

function report(ctx: Ctx, req: IncomingMessage, res: ServerResponse, _params: string[], _body: unknown, _raw: Buffer, actor: Actor): Promise<void> {
  sendJson(res, 200, businessReport(ctx, actor, query(req, "from"), query(req, "to")));
  return Promise.resolve();
}

async function importer(ctx: Ctx, _req: IncomingMessage, res: ServerResponse, _params: string[], body: unknown, _raw: Buffer, actor: Actor): Promise<void> {
  if (!isRecord(body) || typeof body.csv !== "string") {
    throw new AppError("invalid_field", "Paste the CSV text to import.", 400);
  }
  sendJson(res, 200, await importCustomers(ctx, actor, body.csv));
}

function resolveActor(ctx: Ctx, req: IncomingMessage): Actor | null {
  if (!ctx.config.auth.required) return { role: "office", name: "Office" };
  const token = readCookie(req.headers.cookie, "scb_session");
  const secret = ctx.config.auth.sessionSecret;
  if (!token || !secret) return null;
  const opened = openSession(token, secret, Date.now());
  if (!opened) return null;
  if (opened.role === "technician" && opened.technicianId) {
    return { role: "technician", technicianId: opened.technicianId, name: opened.name };
  }
  return { role: "office", name: opened.name || "Office" };
}

function query(req: IncomingMessage, name: string): string {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams.get(name) ?? "";
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return typeof value === "string" ? value : null;
}

function parseJson(raw: Buffer, pathname: string): unknown {
  if (pathname === "/api/webhooks/stripe") return {};
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    throw new AppError("invalid_json", "Request body must be JSON.", 400);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readBuffer(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > limit) throw new AppError("body_too_large", "Request body is too large.", 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const name = staticFiles[pathname];
  if (!name) {
    sendJson(res, 404, { error: { code: "not_found", message: "That page is not in the app." } });
    return;
  }
  const path = normalize(join(publicDir, name));
  if (!path.startsWith(publicDir)) {
    sendJson(res, 404, { error: { code: "not_found", message: "That page is not in the app." } });
    return;
  }
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  const body = await readFile(path);
  res.writeHead(200, {
    "content-type": types[extname(name)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  res.end(body);
}
