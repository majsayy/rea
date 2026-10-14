import type { Address, Customer, SyncState } from "../domain/types.ts";
import { AppError } from "../domain/errors.ts";
import { findDuplicate } from "../domain/duplicates.ts";
import { formatCents } from "../domain/money.ts";
import type { Actor } from "../app/actors.ts";
import { assertOffice } from "../app/actors.ts";
import type { Ctx } from "../app/context.ts";
import type { AddressDraft } from "../app/validate.ts";

const STATUS_TAGS = ["scb-job-scheduled", "scb-job-on-my-way", "scb-job-in-progress", "scb-job-done"] as const;

export async function pushContact(
  ctx: Ctx,
  customer: Customer,
  address: Address | null,
): Promise<SyncState> {
  if (!ctx.ghl) return { state: "skipped", reason: "ghl_not_configured" };
  try {
    const contact = await ctx.ghl.upsertContact({
      id: customer.ghlContactId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
      email: customer.email,
      address1: address?.line1 ?? null,
      city: address?.city ?? null,
      state: address?.state ?? null,
      postalCode: address?.postalCode ?? null,
    });
    if (contact.id && contact.id !== customer.ghlContactId) {
      ctx.store.updateCustomer(customer.id, {
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        email: customer.email,
        ghlContactId: contact.id,
        stripeCustomerId: customer.stripeCustomerId,
      });
      customer.ghlContactId = contact.id;
    }
    record(ctx, "contact.upsert", "sent", null);
    return { state: "sent" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "GoHighLevel contact sync failed";
    record(ctx, "contact.upsert", "failed", detail);
    return { state: "failed", detail };
  }
}

export async function pushJobStatus(
  ctx: Ctx,
  input: { jobId: string; title: string; status: string; totalCents: number; scheduledStart: string; opportunityId: string | null },
  customer: Customer,
  address: Address | null,
): Promise<SyncState> {
  if (!ctx.ghl) return { state: "skipped", reason: "ghl_not_configured" };
  try {
    const contactSync = await pushContact(ctx, customer, address);
    if (contactSync.state === "failed") return contactSync;
    const contactId = customer.ghlContactId;
    if (!contactId) return { state: "failed", detail: "GoHighLevel did not return a contact id" };
    const tag = statusTag(input.status);
    await ctx.ghl.removeTags(contactId, STATUS_TAGS.filter((item) => item !== tag));
    await ctx.ghl.addTags(contactId, [tag]);
    await ctx.ghl.addNote(
      contactId,
      `Job "${input.title}" is ${label(input.status)}. Scheduled ${input.scheduledStart}. Total ${formatCents(input.totalCents)}.`,
    );
    const stage = stageFor(ctx, input.status);
    if (input.opportunityId && stage) await ctx.ghl.updateOpportunityStage(input.opportunityId, stage);
    record(ctx, "job.status", "sent", input.status);
    return { state: "sent" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "GoHighLevel job sync failed";
    record(ctx, "job.status", "failed", detail);
    return { state: "failed", detail };
  }
}

export async function pushInvoiceEvent(
  ctx: Ctx,
  input: { number: string; totalCents: number; opportunityId: string | null },
  customer: Customer,
): Promise<SyncState> {
  if (!ctx.ghl || !customer.ghlContactId) {
    return { state: "skipped", reason: ctx.ghl ? "no_ghl_contact" : "ghl_not_configured" };
  }
  try {
    await ctx.ghl.addTags(customer.ghlContactId, ["scb-invoiced"]);
    await ctx.ghl.addNote(
      customer.ghlContactId,
      `Invoice ${input.number} issued for ${formatCents(input.totalCents)}.`,
    );
    if (input.opportunityId && ctx.config.ghl.stageInvoiced) {
      await ctx.ghl.updateOpportunityStage(input.opportunityId, ctx.config.ghl.stageInvoiced);
    }
    record(ctx, "invoice.issued", "sent", input.number);
    return { state: "sent" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "GoHighLevel invoice sync failed";
    record(ctx, "invoice.issued", "failed", detail);
    return { state: "failed", detail };
  }
}

export async function pushPaymentEvent(
  ctx: Ctx,
  input: { amountCents: number; provider: string; opportunityId: string | null },
  customer: Customer,
): Promise<SyncState> {
  if (!ctx.ghl || !customer.ghlContactId) {
    return { state: "skipped", reason: ctx.ghl ? "no_ghl_contact" : "ghl_not_configured" };
  }
  try {
    await ctx.ghl.addTags(customer.ghlContactId, ["scb-paid"]);
    await ctx.ghl.addNote(
      customer.ghlContactId,
      `Payment of ${formatCents(input.amountCents)} recorded via ${input.provider}.`,
    );
    if (input.opportunityId && ctx.config.ghl.stagePaid) {
      await ctx.ghl.updateOpportunityStage(input.opportunityId, ctx.config.ghl.stagePaid);
    }
    record(ctx, "payment.recorded", "sent", input.provider);
    return { state: "sent" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "GoHighLevel payment sync failed";
    record(ctx, "payment.recorded", "failed", detail);
    return { state: "failed", detail };
  }
}

export function existingDuplicate(
  ctx: Ctx,
  input: { lastName: string; phone: string; address: AddressDraft | null },
  exceptId?: string,
) {
  return findDuplicate(
    ctx.store.matchCandidates().filter((candidate) => candidate.id !== exceptId),
    {
      lastName: input.lastName,
      phone: input.phone,
      addressKeys: input.address ? [input.address.addressKey] : [],
    },
  );
}

function statusTag(status: string): string {
  if (status === "on_my_way") return "scb-job-on-my-way";
  if (status === "in_progress") return "scb-job-in-progress";
  if (status === "done") return "scb-job-done";
  return "scb-job-scheduled";
}

function label(status: string): string {
  if (status === "on_my_way") return "on the way";
  if (status === "in_progress") return "in progress";
  if (status === "done") return "done";
  return "scheduled";
}

function stageFor(ctx: Ctx, status: string): string | null {
  if (status === "scheduled") return ctx.config.ghl.stageScheduled;
  if (status === "on_my_way") return ctx.config.ghl.stageOnMyWay;
  if (status === "in_progress") return ctx.config.ghl.stageInProgress;
  if (status === "done") return ctx.config.ghl.stageDone;
  return null;
}

function record(ctx: Ctx, eventType: string, status: string, detail: string | null): void {
  ctx.store.insertEvent({
    direction: "outbound",
    eventType,
    payload: { eventType, detail },
    status,
    detail,
  });
}

export function requireCustomer(ctx: Ctx, id: string): Customer {
  const customer = ctx.store.getCustomer(id);
  if (!customer) throw new AppError("not_found", "Customer not found.", 404);
  return customer;
}

export function requireAddress(ctx: Ctx, id: string, customerId: string): Address {
  const address = ctx.store.getAddress(id);
  if (!address || address.customerId !== customerId) {
    throw new AppError("not_found", "Address not found for that customer.", 404);
  }
  return address;
}

export function officeActor(actor: Actor): void {
  assertOffice(actor);
}
