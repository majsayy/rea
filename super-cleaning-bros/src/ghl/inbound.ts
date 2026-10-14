import { AppError } from "../domain/errors.ts";
import { normalizePhone, postalDigits, addressKey } from "../domain/normalize.ts";
import type { IncomingBooking, IncomingContact } from "./parse.ts";
import { parseGhlWebhook } from "./parse.ts";
import type { Ctx } from "../app/context.ts";
import type { Actor } from "../app/actors.ts";
import { saveCustomer } from "../app/customers.ts";
import { createJob } from "../app/jobs.ts";
import { addNote } from "../app/jobs.ts";

const systemActor: Actor = { role: "system", name: "GoHighLevel" };

export async function handleGhlWebhook(ctx: Ctx, payload: unknown, receiptId: string | null) {
  if (receiptId && ctx.store.hasReceipt(receiptId)) return { duplicate: true };
  if (receiptId) ctx.store.insertReceipt(receiptId);
  try {
    const parsed = parseGhlWebhook(payload);
    if (parsed.kind === "ignore") {
      ctx.store.insertEvent({
        direction: "inbound",
        eventType: "ignore",
        payload,
        status: "skipped",
        detail: parsed.reason,
      });
      return { ignored: true, reason: parsed.reason };
    }
    if (parsed.kind === "contact") {
      const contact = await hydrateContact(ctx, parsed.contact);
      const saved = await saveCustomer(ctx, systemActor, toCustomerInput(contact), { sync: false });
      ctx.store.insertEvent({
        direction: "inbound",
        eventType: "contact",
        payload,
        status: "processed",
        detail: saved.customer.id,
      });
      return { customerId: saved.customer.id, matchedExisting: saved.matchedExisting, matchedOn: saved.matchedOn };
    }
    const booking = parsed.booking;
    const contact = await hydrateContact(ctx, booking.contact);
    if (booking.cancelled) {
      const existing = findExistingJob(ctx, booking);
      if (existing) addNote(ctx, systemActor, existing.id, { body: "GoHighLevel marked this appointment cancelled." });
      ctx.store.insertEvent({
        direction: "inbound",
        eventType: "booking.cancelled",
        payload,
        status: "processed",
        detail: existing?.id ?? "no local job",
      });
      return { cancelled: true, jobId: existing?.id ?? null };
    }
    const saved = await saveCustomer(ctx, systemActor, toCustomerInput(contact, booking.addressLine), { sync: false });
    const existing = findExistingJob(ctx, booking);
    if (existing) {
      ctx.store.insertEvent({
        direction: "inbound",
        eventType: "booking",
        payload,
        status: "processed",
        detail: `existing ${existing.id}`,
      });
      return { jobId: existing.id, customerId: saved.customer.id, existing: true };
    }
    if (!saved.address) throw new AppError("invalid_field", "The GoHighLevel booking did not include an address.", 422);
    const job = await createJob(ctx, systemActor, {
      customerId: saved.customer.id,
      addressId: saved.address.id,
      title: booking.title,
      scheduledStart: booking.start ?? fallbackStart(ctx),
      scheduledEnd: booking.end ?? undefined,
      lockedTotalCents: booking.monetaryCents ?? undefined,
      serviceCents: booking.monetaryCents === null ? 0 : undefined,
      ghlOpportunityId: booking.opportunityId ?? undefined,
      ghlAppointmentId: booking.appointmentId ?? undefined,
      technicianIds: [],
    });
    ctx.store.insertEvent({
      direction: "inbound",
      eventType: "booking",
      payload,
      status: "processed",
      detail: job.job.id,
    });
    return { jobId: job.job.id, customerId: saved.customer.id, existing: false };
  } catch (error) {
    if (receiptId) ctx.store.deleteReceipt(receiptId);
    const detail = error instanceof Error ? error.message : "Webhook failed";
    ctx.store.insertEvent({
      direction: "inbound",
      eventType: "error",
      payload,
      status: "failed",
      detail,
    });
    throw error;
  }
}

async function hydrateContact(ctx: Ctx, contact: IncomingContact): Promise<IncomingContact> {
  const incomplete = !contact.phone && !contact.lastName;
  if (!incomplete || !contact.id || !ctx.ghl) return contact;
  const fetched = await ctx.ghl.getContact(contact.id);
  return fetched ?? contact;
}

function toCustomerInput(contact: IncomingContact, addressLine?: string | null) {
  const address = addressFromContact(contact, addressLine ?? null);
  return {
    firstName: contact.firstName,
    lastName: contact.lastName || "Customer",
    phone: normalizePhone(contact.phone),
    email: contact.email,
    ghlContactId: contact.id,
    address,
  };
}

function addressFromContact(contact: IncomingContact, addressLine: string | null) {
  const postalCode = postalDigits(contact.postalCode ?? "") || postalDigits(addressLine ?? "");
  const line1 = contact.address1 || addressLine;
  if (!line1 || !postalCode) return null;
  const city = contact.city ?? "";
  const state = (contact.state ?? "").slice(0, 2).toUpperCase();
  return {
    line1,
    line2: null,
    city,
    state,
    postalCode,
    lat: null,
    lng: null,
    addressKey: addressKey({ line1, line2: null, city, state, postalCode }),
  };
}

function findExistingJob(ctx: Ctx, booking: IncomingBooking) {
  if (booking.appointmentId) {
    const job = ctx.store.findJobByAppointment(booking.appointmentId);
    if (job) return job;
  }
  if (booking.opportunityId) return ctx.store.findJobByOpportunity(booking.opportunityId);
  return null;
}

function fallbackStart(ctx: Ctx): string {
  const start = new Date(ctx.store.now().getTime() + 24 * 60 * 60 * 1000);
  start.setUTCMinutes(0, 0, 0);
  return start.toISOString();
}
