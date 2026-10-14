import { randomBytes } from "node:crypto";

import type { Actor } from "./actors.ts";
import type { Ctx } from "./context.ts";
import { activeJobForContact } from "../domain/jobStatus.ts";
import { AppError } from "../domain/errors.ts";
import { normalizePhone } from "../domain/normalize.ts";
import { DEFAULT_TEMPLATES, renderTemplate, type TemplateKey } from "../domain/templates.ts";
import { formatDenver } from "../domain/time.ts";
import type { Address, Customer, CustomerMessage, Job, MessageTemplate } from "../domain/types.ts";
import type { IncomingMessage } from "../ghl/parse.ts";
import { cleanMultiline, cleanText } from "./validate.ts";

export type NotifyTarget = {
  job: Job;
  customer: Customer;
  address: Address;
  technicianIds: string[];
};

const UNSCHEDULED_START = "1970-01-01T00:00:00.000Z";
const UNSCHEDULED_END = "1970-01-01T01:00:00.000Z";

export function unscheduledWindow(): { scheduledStart: string; scheduledEnd: string } {
  return { scheduledStart: UNSCHEDULED_START, scheduledEnd: UNSCHEDULED_END };
}

export async function notifyStatus(
  ctx: Ctx,
  target: NotifyTarget,
  previousStatus: Job["status"],
  actor: Actor,
): Promise<CustomerMessage | null> {
  if (target.job.status === previousStatus) return null;
  if (target.job.status === "on_my_way") return sendTemplate(ctx, target, actor, "on_my_way", `job:${target.job.id}:notify:on_my_way`);
  if (target.job.status === "in_progress") return sendTemplate(ctx, target, actor, "started", `job:${target.job.id}:notify:started`);
  if (target.job.status === "done") {
    await sendTemplate(ctx, target, actor, "finished", `job:${target.job.id}:notify:finished`);
    if (ctx.config.ghl.reviewUrl) {
      return sendTemplate(ctx, target, actor, "review", `job:${target.job.id}:notify:review`);
    }
  }
  return null;
}

export async function notifyReschedule(ctx: Ctx, target: NotifyTarget, actor: Actor): Promise<CustomerMessage | null> {
  if (target.job.unscheduled) return null;
  return sendTemplate(
    ctx,
    target,
    actor,
    "reschedule",
    `job:${target.job.id}:notify:reschedule:${target.job.scheduledStart}`,
  );
}

export async function notifyPhotos(ctx: Ctx, target: NotifyTarget, actor: Actor): Promise<CustomerMessage | null> {
  const before = ctx.store.countPhotosByKind(target.job.id, "before");
  const after = ctx.store.countPhotosByKind(target.job.id, "after");
  if (before < 1 || after < 1) return null;
  const token = ensureShareToken(ctx, target.job);
  target.job.shareToken = token;
  return sendTemplate(ctx, target, actor, "photos", `job:${target.job.id}:notify:photos`);
}

export async function sendManualMessage(ctx: Ctx, target: NotifyTarget, actor: Actor, body: unknown): Promise<CustomerMessage> {
  if (!isPlainRecord(body)) throw new AppError("invalid_field", "Message text is required.", 400);
  const text = cleanMultiline(body.body, "Message", 1000);
  const supplied = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const key = supplied
    ? `job:${target.job.id}:manual:${cleanText(supplied, "Idempotency key", 120)}`
    : `job:${target.job.id}:manual:${ctx.store.id()}`;
  const message = await deliver(ctx, target, {
    trigger: "manual",
    idempotencyKey: key,
    channel: "sms",
    subject: null,
    body: text,
    emailOnly: false,
  });
  if (!message) throw new AppError("duplicate_message", "That message was already sent.", 409);
  return message;
}

export async function recordInboundMessage(ctx: Ctx, message: IncomingMessage): Promise<{ jobId: string | null; duplicate: boolean }> {
  const customer = ctx.store.findCustomerByGhl(message.contactId);
  if (!customer) return { jobId: null, duplicate: false };
  const job = activeJobForContact(ctx.store.jobsForCustomer(customer.id), ctx.store.now().toISOString());
  if (!job) return { jobId: null, duplicate: false };
  const idempotencyKey = message.messageId
    ? `ghl:inbound:${message.messageId}`
    : `ghl:inbound:${customer.id}:${message.body.slice(0, 80)}`;
  const claim = ctx.store.claimMessage({
    jobId: job.id,
    customerId: customer.id,
    direction: "inbound",
    channel: message.channel,
    body: message.body.slice(0, 4000),
    subject: null,
    status: "sending",
    idempotencyKey,
    trigger: "inbound",
  });
  if (!claim.proceed) return { jobId: job.id, duplicate: true };
  ctx.store.completeMessage(claim.message.id, "sent", {
    ghlMessageId: message.messageId,
    ghlConversationId: message.conversationId,
    detail: null,
  });
  return { jobId: job.id, duplicate: false };
}

export function listTemplates(ctx: Ctx): MessageTemplate[] {
  return ctx.store.ensureTemplates(DEFAULT_TEMPLATES);
}

export function saveTemplates(ctx: Ctx, body: unknown): MessageTemplate[] {
  if (!isPlainRecord(body) || !Array.isArray(body.templates)) {
    throw new AppError("invalid_field", "Send the message templates to save.", 400);
  }
  const current = new Map(listTemplates(ctx).map((template) => [template.key, template]));
  for (const item of body.templates) {
    if (!isPlainRecord(item) || typeof item.key !== "string") {
      throw new AppError("invalid_field", "Each template needs a key.", 400);
    }
    const existing = current.get(item.key);
    if (!existing) throw new AppError("invalid_field", `Unknown template ${item.key}.`, 400);
    const text = cleanMultiline(item.body, "Template", 1000);
    const subject = existing.channel === "email" ? cleanText(item.subject ?? existing.subject ?? "Super Cleaning Bros", "Subject", 140) : null;
    ctx.store.saveTemplate({ key: existing.key, channel: existing.channel, subject, body: text });
  }
  return listTemplates(ctx);
}

export function photoPageUrl(ctx: Ctx, token: string): string {
  return `${ctx.config.publicBaseUrl}/share/${token}`;
}

async function sendTemplate(
  ctx: Ctx,
  target: NotifyTarget,
  actor: Actor,
  key: TemplateKey,
  idempotencyKey: string,
): Promise<CustomerMessage | null> {
  const template = listTemplates(ctx).find((item) => item.key === key) ?? DEFAULT_TEMPLATES.find((item) => item.key === key);
  if (!template) return null;
  const vars = await templateVars(ctx, target, actor);
  return deliver(ctx, target, {
    trigger: key,
    idempotencyKey,
    channel: template.channel,
    subject: template.subject ? renderTemplate(template.subject, vars) : null,
    body: renderTemplate(template.body, vars),
    emailOnly: key === "photos",
  });
}

async function deliver(
  ctx: Ctx,
  target: NotifyTarget,
  input: {
    trigger: string;
    idempotencyKey: string;
    channel: "sms" | "email";
    subject: string | null;
    body: string;
    emailOnly: boolean;
  },
): Promise<CustomerMessage | null> {
  const channel = chooseChannel(ctx, target.customer, input.channel, input.emailOnly);
  const claim = ctx.store.claimMessage({
    jobId: target.job.id,
    customerId: target.customer.id,
    direction: "outbound",
    channel: channel.channel,
    body: input.body,
    subject: input.subject,
    status: "sending",
    idempotencyKey: input.idempotencyKey,
    trigger: input.trigger,
  });
  if (!claim.proceed) return claim.message;
  if (!ctx.ghl || !target.customer.ghlContactId) {
    ctx.store.completeMessage(claim.message.id, "skipped", {
      ghlMessageId: null,
      ghlConversationId: null,
      detail: ctx.ghl ? "no_ghl_contact" : "ghl_not_configured",
    });
    return reload(ctx, claim.message.id);
  }
  if (channel.reason) {
    ctx.store.completeMessage(claim.message.id, "skipped", {
      ghlMessageId: null,
      ghlConversationId: null,
      detail: channel.reason,
    });
    return reload(ctx, claim.message.id);
  }
  try {
    const sent = await ctx.ghl.sendConversationMessage({
      contactId: target.customer.ghlContactId,
      channel: channel.channel,
      message: input.body,
      subject: input.subject,
      emailFrom: ctx.config.ghl.emailFrom,
    });
    await ctx.ghl.addNote(target.customer.ghlContactId, input.body);
    if (input.trigger === "photos" && ctx.config.ghl.photoLinkFieldId && target.job.shareToken) {
      await ctx.ghl.setCustomField(
        target.customer.ghlContactId,
        ctx.config.ghl.photoLinkFieldId,
        photoPageUrl(ctx, target.job.shareToken),
      );
    }
    ctx.store.completeMessage(claim.message.id, "sent", {
      ghlMessageId: sent.messageId,
      ghlConversationId: sent.conversationId,
      detail: null,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "GoHighLevel did not send the message";
    ctx.store.completeMessage(claim.message.id, "failed", {
      ghlMessageId: null,
      ghlConversationId: null,
      detail,
    });
  }
  return reload(ctx, claim.message.id);
}

function chooseChannel(
  ctx: Ctx,
  customer: Customer,
  preferred: "sms" | "email",
  emailOnly: boolean,
): { channel: "sms" | "email"; reason: string | null } {
  const phone = normalizePhone(customer.phone).length >= 10;
  const emailReady = Boolean(customer.email && ctx.config.ghl.emailFrom);
  if (emailOnly || preferred === "email") {
    if (!customer.email) return { channel: "email", reason: "customer_email_missing" };
    if (!ctx.config.ghl.emailFrom) return { channel: "email", reason: "ghl_email_from_missing" };
    return { channel: "email", reason: null };
  }
  if (phone) return { channel: "sms", reason: null };
  if (emailReady) return { channel: "email", reason: null };
  return { channel: "sms", reason: "no_destination" };
}

async function templateVars(ctx: Ctx, target: NotifyTarget, actor: Actor): Promise<Record<string, string>> {
  const drive = await ctx.driveTime.estimate(target.address);
  const eta = drive.minutes === null ? "shortly" : `in about ${Math.max(1, Math.round(drive.minutes))} minutes`;
  const token = target.job.shareToken;
  return {
    customerFirst: target.customer.firstName || "there",
    techName: technicianName(ctx, target, actor),
    eta,
    address: `${target.address.line1}, ${target.address.city}`,
    when: target.job.unscheduled ? "a time we'll confirm" : formatDenver(target.job.scheduledStart),
    reviewUrl: ctx.config.ghl.reviewUrl ?? "",
    photoUrl: token ? photoPageUrl(ctx, token) : "",
    shop: ctx.config.shop.name,
  };
}

function technicianName(ctx: Ctx, target: NotifyTarget, actor: Actor): string {
  if (actor.role === "technician") return actor.name;
  for (const id of target.technicianIds) {
    const technician = ctx.store.getTechnician(id);
    if (technician) return technician.name;
  }
  return "your technician";
}

function ensureShareToken(ctx: Ctx, job: Job): string {
  if (job.shareToken) return job.shareToken;
  const token = randomBytes(24).toString("base64url");
  return ctx.store.setShareToken(job.id, token) ?? token;
}

function reload(ctx: Ctx, id: string): CustomerMessage | null {
  return ctx.store.messageById(id);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
