import { resolve } from "node:path";

import { buildContext } from "../src/app/context.ts";
import { loadConfig } from "../src/config.ts";
import { loadEnvFile } from "../src/env.ts";
import { createHttpServer } from "../src/http/server.ts";

/**
 * Live GoHighLevel lifecycle for ONE test contact.
 * This sends real texts and emails through GoHighLevel. It refuses to start
 * unless GHL_E2E_CONFIRM=majdi-test-contact, and it only addresses the contact
 * named in GHL_TEST_CONTACT_*. It uses data/ghl-e2e.sqlite, not the shop database.
 *
 * Do not point GHL_TEST_CONTACT_* at a paying customer.
 */

process.env.DATABASE_PATH = resolve(process.cwd(), "data/ghl-e2e.sqlite");
process.env.PORT = process.env.GHL_E2E_PORT?.trim() || "8799";
loadEnvFile(resolve(process.cwd(), ".env"), process.env);

const required = [
  "GHL_E2E_CONFIRM",
  "GHL_PRIVATE_TOKEN",
  "GHL_LOCATION_ID",
  "GHL_WEBHOOK_SECRET",
  "GHL_TEST_CONTACT_ID",
  "GHL_TEST_CONTACT_FIRST",
  "GHL_TEST_CONTACT_LAST",
  "GHL_TEST_CONTACT_PHONE",
  "GHL_TEST_CONTACT_EMAIL",
  "GHL_EMAIL_FROM",
  "REVIEW_URL",
] as const;

const missing = required.filter((key) => !process.env[key]?.trim());
if (process.env.GHL_E2E_CONFIRM !== "majdi-test-contact") {
  console.error("Refusing to run. Set GHL_E2E_CONFIRM=majdi-test-contact when you mean this test contact only.");
  process.exit(1);
}
if (missing.length > 0) {
  console.error(`Refusing to run. Missing ${missing.join(", ")}.`);
  process.exit(1);
}
if (!process.env.DATABASE_PATH.endsWith(`${"ghl-e2e.sqlite"}`)) {
  console.error("Refusing to run. The lifecycle database must be data/ghl-e2e.sqlite.");
  process.exit(1);
}

const contact = {
  id: requiredEnv("GHL_TEST_CONTACT_ID"),
  firstName: requiredEnv("GHL_TEST_CONTACT_FIRST"),
  lastName: requiredEnv("GHL_TEST_CONTACT_LAST"),
  phone: requiredEnv("GHL_TEST_CONTACT_PHONE"),
  email: requiredEnv("GHL_TEST_CONTACT_EMAIL"),
};

console.log("Super Cleaning Bros live GoHighLevel lifecycle");
console.log(`Database: ${process.env.DATABASE_PATH}`);
console.log(`Contact only: ${contact.firstName} ${contact.lastName} ${contact.phone} ${contact.email} (${contact.id})`);
console.log("No other GoHighLevel contact is read from the shop database.");
if ((process.env.PUBLIC_BASE_URL ?? "").includes("localhost")) {
  console.log("PUBLIC_BASE_URL is local. The photo link in the email will not open on a phone until that URL is the public site.");
}

const config = loadConfig(process.env);
const { ctx, close } = buildContext({ config });
const server = createHttpServer(ctx);
await new Promise<void>((resolveListen) => server.listen(config.port, "127.0.0.1", () => resolveListen()));
const base = `http://127.0.0.1:${config.port}`;
let cookie = "";

try {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  if (config.auth.required) {
    const login = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: process.env.OFFICE_PASSWORD }),
    });
    if (!login.ok) throw new Error(`Office sign-in failed (${login.status}).`);
  }

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const booked = await api("/api/webhooks/ghl", {
    method: "POST",
    headers: { "x-scb-webhook-secret": requiredEnv("GHL_WEBHOOK_SECRET") },
    body: JSON.stringify({
      type: "AppointmentCreate",
      id: `e2e-${stamp}`,
      title: "Lifecycle test clean",
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      endTime: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
      contactId: contact.id,
      contact: {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        address1: "10 Test St",
        city: "Erie",
        state: "CO",
        postalCode: "80516",
      },
    }),
  });
  const booking = await json(booked);
  const jobId = typeof booking.jobId === "string" ? booking.jobId : "";
  if (!booked.ok || !jobId) throw new Error(`Booking did not create a job: ${JSON.stringify(booking)}`);
  console.log(`\n1. Booking created job ${jobId}. No customer text yet. GoHighLevel gets a contact note and the scb-job-scheduled tag.`);

  const crew = await api("/api/technicians", {
    method: "POST",
    body: JSON.stringify({ name: "Lifecycle Tech", pin: "2468", phone: "" }),
  });
  const crewBody = await json(crew);
  const technician = crewBody.technician;
  const technicianId =
    technician && typeof technician === "object" && "id" in technician && typeof technician.id === "string"
      ? technician.id
      : "";
  if (technicianId) {
    await api(`/api/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify({ technicianIds: [technicianId] }) });
  }

  await step(jobId, "on_my_way", "2. On my way. Expect one SMS: tech name, address, and an ETA (or \"shortly\"). A contact note gets the same text. Tag scb-job-on-my-way.");
  await step(jobId, "in_progress", "3. Start. Expect one SMS that the job started. Tag scb-job-in-progress.");

  for (const kind of ["before", "after"] as const) {
    const uploaded = await api(`/api/jobs/${jobId}/photos`, {
      method: "POST",
      body: JSON.stringify({ kind, contentType: "image/png", dataBase64: png }),
    });
    if (!uploaded.ok) throw new Error(`Photo ${kind} failed (${uploaded.status}).`);
  }
  const detail = await json(await api(`/api/jobs/${jobId}`));
  const photoUrl = detail && typeof detail === "object" && "photoUrl" in detail ? String(detail.photoUrl) : "";
  console.log(`4. Photos. Expect one email from ${process.env.GHL_EMAIL_FROM} with subject "Your Super Cleaning Bros photos" and this link: ${photoUrl}`);
  console.log("   The same link is a contact note. If GHL_PHOTO_LINK_FIELD_ID is set, that custom field is updated too. There is no photo text message.");

  await step(jobId, "done", `5. Finish. Expect one SMS that the job is finished, then one SMS with the review link ${process.env.REVIEW_URL}. Tag scb-job-done.`);
  console.log("\nDone. Check that contact in GoHighLevel. Run this again only for the same test contact; each run adds another job.");
} finally {
  server.close();
  close();
}

async function step(jobId: string, status: string, label: string): Promise<void> {
  const response = await api(`/api/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify({ status }) });
  const body = await json(response);
  if (!response.ok) throw new Error(`${status} failed: ${JSON.stringify(body)}`);
  console.log(label);
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (setCookies.length > 0) cookie = setCookies.map((item) => item.split(";")[0] ?? "").filter(Boolean).join("; ");
  return response;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
