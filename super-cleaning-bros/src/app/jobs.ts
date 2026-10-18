import type { Address, Customer, Job, JobStatus, LineItem, SyncState } from "../domain/types.ts";
import { chargeDecision } from "../domain/chargeGate.ts";
import { planPriceChange } from "../domain/changeOrder.ts";
import { AppError, isRecord } from "../domain/errors.ts";
import { isJobStatus, NEXT_STATUS } from "../domain/jobStatus.ts";
import { assertCents, formatCents } from "../domain/money.ts";
import { applyAcceptedPrice } from "../domain/pricing.ts";
import { splitAcceptedTotal, travelFeeForMiles } from "../domain/travel.ts";
import { parseAppTime } from "../domain/time.ts";
import type { Actor } from "./actors.ts";
import { assertOffice, authorName } from "./actors.ts";
import type { Ctx } from "./context.ts";
import { pushJobStatus, requireAddress, requireCustomer } from "../ghl/outbound.ts";
import { notifyPhotos, notifyReschedule, notifyStatus, photoPageUrl, sendManualMessage, unscheduledWindow } from "./notify.ts";
import { cleanMultiline, cleanText, optionalText } from "./validate.ts";

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function createJob(ctx: Ctx, actor: Actor, body: unknown) {
  assertOffice(actor);
  if (!isRecord(body)) throw new AppError("invalid_field", "Job details are required.", 400);
  const customer = requireCustomer(ctx, String(body.customerId ?? ""));
  const address = requireAddress(ctx, String(body.addressId ?? ""), customer.id);
  const title = cleanText(body.title ?? "Cleaning", "Job title", 200);
  const unscheduled = body.unscheduled === true;
  const window = unscheduled ? unscheduledWindow() : null;
  const scheduledStart = window ? window.scheduledStart : parseAppTime(body.scheduledStart, "Start");
  const scheduledEnd = window
    ? window.scheduledEnd
    : body.scheduledEnd
      ? parseAppTime(body.scheduledEnd, "End")
      : new Date(new Date(scheduledStart).getTime() + 2 * 60 * 60 * 1000).toISOString();
  if (scheduledEnd <= scheduledStart) {
    throw new AppError("invalid_time", "The job must end after it starts.", 400);
  }
  const arrival = readArrival(body.arrivalStart, body.arrivalEnd);
  const technicianIds = readIds(body.technicianIds);
  assertCrew(ctx, technicianIds);
  const priced = await priceNewJob(ctx, customer, address, {
    title,
    estimateId: typeof body.estimateId === "string" ? body.estimateId : null,
    serviceCents: typeof body.serviceCents === "number" ? body.serviceCents : null,
    lockedTotalCents: typeof body.lockedTotalCents === "number" ? assertCents(body.lockedTotalCents, "Accepted price") : null,
  });
  let job: Job;
  try {
    job = ctx.store.insertJob({
    customerId: customer.id,
    addressId: address.id,
    estimateId: priced.estimateId,
    title,
    scheduledStart,
    scheduledEnd,
    status: readInitialStatus(body.status),
    priceLocked: priced.priceLocked,
    serviceCents: priced.serviceCents,
    travelFeeCents: priced.travelFeeCents,
    totalCents: priced.totalCents,
    lineItems: priced.lineItems,
    postWalkthroughComplete: false,
    ghlOpportunityId: typeof body.ghlOpportunityId === "string" ? body.ghlOpportunityId : null,
    ghlAppointmentId: typeof body.ghlAppointmentId === "string" ? body.ghlAppointmentId : null,
    unscheduled,
    arrivalStart: arrival.start,
    arrivalEnd: arrival.end,
    accessNotes: optionalText(body.accessNotes, "Access notes", 2000),
    shareToken: null,
    technicianIds,
    });
  } catch (error) {
    const appointmentId = typeof body.ghlAppointmentId === "string" ? body.ghlAppointmentId : "";
    if (appointmentId && error instanceof Error && error.message.includes("UNIQUE")) {
      const existing = ctx.store.findJobByAppointment(appointmentId);
      if (existing) return { ...jobDetail(ctx, actor, existing.id), sync: { state: "skipped" as const, reason: "already_booked" } };
    }
    throw error;
  }
  const detail = jobDetail(ctx, actor, job.id);
  const sync = await pushJobStatus(ctx, jobSnapshot(detail), detail.customer, detail.address);
  return { ...detail, sync };
}

export async function updateJob(ctx: Ctx, actor: Actor, id: string, body: unknown) {
  if (!isRecord(body)) throw new AppError("invalid_field", "Job changes are required.", 400);
  const current = requireJob(ctx, id);
  const technicianIds = ctx.store.assignmentIds(id);
  assertCanSee(actor, technicianIds);
  const scheduling =
    body.title !== undefined ||
    body.scheduledStart !== undefined ||
    body.scheduledEnd !== undefined ||
    body.technicianIds !== undefined ||
    body.unscheduled !== undefined ||
    body.arrivalStart !== undefined ||
    body.arrivalEnd !== undefined;
  if (scheduling && actor.role === "technician") {
    throw new AppError("forbidden", "Crew can update status, notes, and photos. Schedule changes belong in the office.", 403);
  }
  let status = current.status;
  if (body.status !== undefined) {
    status = readStatus(body.status);
    if (status !== current.status && !NEXT_STATUS[current.status].includes(status)) {
      throw new AppError("invalid_status", `A ${current.status.replace("_", " ")} job cannot move to ${status.replace("_", " ")}.`, 409);
    }
  }
  const nextTechnicians = body.technicianIds === undefined ? technicianIds : readIds(body.technicianIds);
  if (body.technicianIds !== undefined) assertCrew(ctx, nextTechnicians);
  const unscheduled = body.unscheduled === undefined ? current.unscheduled : body.unscheduled === true;
  const scheduledStart = unscheduled
    ? unscheduledWindow().scheduledStart
    : body.scheduledStart === undefined
      ? current.scheduledStart
      : parseAppTime(body.scheduledStart, "Start");
  const scheduledEnd = unscheduled
    ? unscheduledWindow().scheduledEnd
    : body.scheduledEnd !== undefined
      ? parseAppTime(body.scheduledEnd, "End")
      : body.scheduledStart !== undefined && current.unscheduled
        ? new Date(new Date(scheduledStart).getTime() + 2 * 60 * 60 * 1000).toISOString()
        : current.scheduledEnd;
  if (!unscheduled && scheduledEnd <= scheduledStart) {
    throw new AppError("invalid_time", "The job must end after it starts.", 400);
  }
  const title = body.title === undefined ? current.title : cleanText(body.title, "Job title", 200);
  const arrival = readArrival(
    body.arrivalStart === undefined ? current.arrivalStart : body.arrivalStart,
    body.arrivalEnd === undefined ? current.arrivalEnd : body.arrivalEnd,
  );
  const accessNotes = body.accessNotes === undefined ? current.accessNotes : optionalText(body.accessNotes, "Access notes", 2000);
  let walkthrough = current.postWalkthroughComplete;
  if (body.postWalkthroughComplete !== undefined) {
    if (typeof body.postWalkthroughComplete !== "boolean") {
      throw new AppError("invalid_field", "Walkthrough must be yes or no.", 400);
    }
    walkthrough = body.postWalkthroughComplete;
  }
  ctx.store.transaction(() => {
    ctx.store.updateJobSchedule(id, {
      title,
      scheduledStart,
      scheduledEnd,
      status,
      postWalkthroughComplete: walkthrough,
      unscheduled,
      arrivalStart: arrival.start,
      arrivalEnd: arrival.end,
      accessNotes,
    });
    if (body.technicianIds !== undefined) ctx.store.replaceAssignments(id, nextTechnicians);
  });
  let detail = jobDetail(ctx, actor, id);
  let sync: SyncState | undefined;
  if (status !== current.status) {
    sync = await pushJobStatus(ctx, jobSnapshot(detail), detail.customer, detail.address);
    await notifyStatus(ctx, notifyTarget(detail), current.status, actor);
    detail = jobDetail(ctx, actor, id);
  }
  const moved = !unscheduled && (scheduledStart !== current.scheduledStart || scheduledEnd !== current.scheduledEnd || current.unscheduled);
  if (body.notifyCustomer === true && moved) {
    await notifyReschedule(ctx, notifyTarget(detail), actor);
    detail = jobDetail(ctx, actor, id);
  }
  return sync ? { ...detail, sync } : detail;
}

export function updateJobPrice(ctx: Ctx, actor: Actor, id: string, body: unknown) {
  const job = requireJob(ctx, id);
  assertCanSee(actor, ctx.store.assignmentIds(id));
  if (!isRecord(body)) throw new AppError("invalid_amount", "Enter the new line items.", 400);
  const lineItems = readLineItems(body, job.title);
  const customerApproved = body.customerApproved === true;
  const reason = typeof body.reason === "string" && body.reason.trim() ? cleanText(body.reason, "Reason", 500) : "Price change";
  const plan = planPriceChange({
    priceLocked: job.priceLocked,
    status: job.status,
    customerApproved,
    travelFeeCents: job.travelFeeCents,
    nextLineItems: lineItems,
  });
  if (plan.mode === "apply") {
    ctx.store.updateJobPrice(id, plan.next.serviceCents, plan.next.totalCents, plan.next.lineItems);
    const order = ctx.store.insertChangeOrder({
      jobId: id,
      authorName: authorName(actor),
      status: "applied",
      customerApproved: plan.customerApproved,
      previousLineItems: job.lineItems,
      nextLineItems: plan.next.lineItems,
      previousTotalCents: job.totalCents,
      nextTotalCents: plan.next.totalCents,
      reason,
    });
    ctx.store.resolveChangeOrder(id, order.id, "applied", authorName(actor));
    ctx.store.insertAudit(
      id,
      authorName(actor),
      plan.customerApproved ? "price.customer_approved" : "price.updated",
      `${formatCents(job.totalCents)} → ${formatCents(plan.next.totalCents)}. ${reason}`,
    );
    return { ...jobDetail(ctx, actor, id), changeOrder: { ...order, status: "applied" as const, resolvedBy: authorName(actor) } };
  }
  const order = ctx.store.insertChangeOrder({
    jobId: id,
    authorName: authorName(actor),
    status: "pending",
    customerApproved: false,
    previousLineItems: job.lineItems,
    nextLineItems: plan.next.lineItems,
    previousTotalCents: job.totalCents,
    nextTotalCents: plan.next.totalCents,
    reason,
  });
  ctx.store.insertAudit(
    id,
    authorName(actor),
    "price.change_order",
    `Proposed ${formatCents(job.totalCents)} → ${formatCents(plan.next.totalCents)}. Waiting for office approval. ${reason}`,
  );
  return { ...jobDetail(ctx, actor, id), changeOrder: order };
}

export function decideChangeOrder(ctx: Ctx, actor: Actor, jobId: string, orderId: string, decision: "approved" | "rejected") {
  assertOffice(actor);
  const job = requireJob(ctx, jobId);
  const order = ctx.store.getChangeOrder(jobId, orderId);
  if (!order) throw new AppError("not_found", "Change order not found.", 404);
  if (order.status !== "pending") throw new AppError("invalid_status", "That change order is already decided.", 409);
  if (decision === "rejected") {
    ctx.store.resolveChangeOrder(jobId, orderId, "rejected", authorName(actor));
    ctx.store.insertAudit(jobId, authorName(actor), "price.rejected", `Rejected the change to ${formatCents(order.nextTotalCents)}.`);
    return jobDetail(ctx, actor, jobId);
  }
  const plan = planPriceChange({
    priceLocked: false,
    status: "scheduled",
    customerApproved: false,
    travelFeeCents: job.travelFeeCents,
    nextLineItems: order.nextLineItems,
  });
  ctx.store.updateJobPrice(jobId, plan.next.serviceCents, plan.next.totalCents, plan.next.lineItems);
  ctx.store.resolveChangeOrder(jobId, orderId, "approved", authorName(actor));
  ctx.store.insertAudit(
    jobId,
    authorName(actor),
    "price.approved",
    `${formatCents(job.totalCents)} → ${formatCents(plan.next.totalCents)}.`,
  );
  return jobDetail(ctx, actor, jobId);
}

export function addNote(ctx: Ctx, actor: Actor, jobId: string, body: unknown) {
  const technicianIds = ctx.store.assignmentIds(jobId);
  requireJob(ctx, jobId);
  assertCanSee(actor, technicianIds);
  if (!isRecord(body)) throw new AppError("invalid_field", "Note text is required.", 400);
  const note = cleanMultiline(body.body, "Note", 4000);
  return ctx.store.insertNote(jobId, authorName(actor), note);
}

export function editNote(ctx: Ctx, actor: Actor, jobId: string, noteId: string, body: unknown) {
  assertCanSee(actor, ctx.store.assignmentIds(jobId));
  requireJob(ctx, jobId);
  if (!isRecord(body)) throw new AppError("invalid_field", "Note text is required.", 400);
  const text = cleanMultiline(body.body, "Note", 4000);
  const updated = ctx.store.updateNote(jobId, noteId, text);
  if (!updated) throw new AppError("not_found", "Note not found.", 404);
  if (updated.previous !== text) {
    ctx.store.insertAudit(jobId, authorName(actor), "note.edit", `${updated.previous} → ${text}`);
  }
  return updated.note;
}

export async function addPhoto(ctx: Ctx, actor: Actor, jobId: string, body: unknown) {
  const technicianIds = ctx.store.assignmentIds(jobId);
  requireJob(ctx, jobId);
  assertCanSee(actor, technicianIds);
  if (!isRecord(body)) throw new AppError("invalid_photo", "Photo details are required.", 400);
  const kind = body.kind;
  if (kind !== "before" && kind !== "after" && kind !== "walkthrough") {
    throw new AppError("invalid_photo", "Photo kind must be before, after, or walkthrough.", 400);
  }
  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  if (!PHOTO_TYPES.has(contentType)) {
    throw new AppError("invalid_photo", "Use a JPEG, PNG, or WebP photo.", 400);
  }
  if (ctx.store.countPhotos(jobId) >= 12) {
    throw new AppError("invalid_photo", "This job already has 12 photos.", 400);
  }
  const bytes = decodePhoto(body.dataBase64);
  const photo = ctx.store.insertPhoto(jobId, kind, contentType, bytes);
  const job = requireJob(ctx, jobId);
  if (kind === "walkthrough") {
    ctx.store.updateJobSchedule(jobId, scheduleOf(job, true));
  }
  const detail = jobDetail(ctx, actor, jobId);
  const notification = await notifyPhotos(ctx, notifyTarget(detail), actor);
  return { ...photo, notification };
}

export async function sendJobMessage(ctx: Ctx, actor: Actor, jobId: string, body: unknown) {
  assertCanSee(actor, ctx.store.assignmentIds(jobId));
  const detail = jobDetail(ctx, actor, jobId);
  return sendManualMessage(ctx, notifyTarget(detail), actor, body);
}

export function readPhoto(ctx: Ctx, actor: Actor, jobId: string, photoId: string) {
  assertCanSee(actor, ctx.store.assignmentIds(jobId));
  const photo = ctx.store.getPhoto(jobId, photoId);
  if (!photo) throw new AppError("not_found", "Photo not found.", 404);
  return photo;
}

export function getJob(ctx: Ctx, actor: Actor, id: string) {
  assertCanSee(actor, ctx.store.assignmentIds(id));
  return jobDetail(ctx, actor, id);
}

export function listUnscheduled(ctx: Ctx, actor: Actor) {
  return presentJobs(ctx, actor, ctx.store.listUnscheduled());
}

export function listJobs(ctx: Ctx, actor: Actor, from: string, to: string) {
  return presentJobs(ctx, actor, ctx.store.listJobs(from, to));
}

function presentJobs(ctx: Ctx, actor: Actor, jobs: Job[]) {
  const rows = jobs.flatMap((job) => {
    const technicianIds = ctx.store.assignmentIds(job.id);
    if (actor.role === "technician" && !technicianIds.includes(actor.technicianId)) return [];
    return [{ job, technicianIds }];
  });
  const invoices = ctx.store.invoiceBriefs(rows.map((row) => row.job.id));
  return rows.map(({ job, technicianIds }) => {
    const customer = ctx.store.getCustomer(job.customerId);
    const address = ctx.store.getAddress(job.addressId);
    return {
      ...job,
      technicianIds,
      customerName: customer ? `${customer.firstName} ${customer.lastName}`.trim() : "Customer",
      addressLine: address ? `${address.line1}, ${address.city} ${address.state} ${address.postalCode}` : "",
      city: address?.city ?? "",
      postalCode: address?.postalCode ?? "",
      phone: customer?.phone ?? "",
      invoice: invoices.get(job.id) ?? null,
    };
  });
}

async function priceNewJob(
  ctx: Ctx,
  customer: Customer,
  address: Address,
  input: { title: string; estimateId: string | null; serviceCents: number | null; lockedTotalCents: number | null },
): Promise<{
  serviceCents: number;
  travelFeeCents: number;
  totalCents: number;
  priceLocked: boolean;
  estimateId: string | null;
  lineItems: LineItem[];
}> {
  if (input.estimateId) {
    const estimate = ctx.store.getEstimate(input.estimateId);
    if (!estimate || estimate.customerId !== customer.id || estimate.addressId !== address.id) {
      throw new AppError("unknown_estimate", "That estimate does not match this customer and address.", 400);
    }
    if (estimate.status !== "accepted") {
      throw new AppError("estimate_not_accepted", "Accept the estimate before scheduling it.", 409);
    }
    return {
      serviceCents: estimate.serviceCents,
      travelFeeCents: estimate.travelFeeCents,
      totalCents: estimate.totalCents,
      priceLocked: true,
      estimateId: estimate.id,
      lineItems: estimate.lineItems.length > 0 ? estimate.lineItems : [{ description: input.title, amountCents: estimate.serviceCents }],
    };
  }
  const drive = await ctx.driveTime.estimate(address);
  const travel = travelFeeForMiles(drive.distanceMiles, ctx.config.travel);
  if (input.lockedTotalCents !== null) {
    const split = splitAcceptedTotal(input.lockedTotalCents, travel.reviewRequired ? 0 : travel.feeCents);
    return {
      ...split,
      priceLocked: true,
      estimateId: null,
      lineItems: [{ description: input.title, amountCents: split.serviceCents }],
    };
  }
  const accepted = ctx.store.latestAcceptedEstimate(customer.id, address.id);
  if (input.serviceCents === null && !accepted) {
    throw new AppError("invalid_amount", "Enter a service price in cents.", 400);
  }
  const serviceCents = assertCents(input.serviceCents ?? accepted?.serviceCents ?? 0, "Service price");
  const quoted = applyAcceptedPrice({
    accepted: accepted
      ? {
          estimateId: accepted.id,
          serviceCents: accepted.serviceCents,
          travelFeeCents: accepted.travelFeeCents,
          totalCents: accepted.totalCents,
        }
      : null,
    calculated: {
      serviceCents,
      travelFeeCents: travel.feeCents,
      totalCents: serviceCents + travel.feeCents,
    },
  });
  if (!quoted.priceLocked && travel.reviewRequired) {
    throw new AppError(
      "travel_review_required",
      "Distance from Erie is unknown. Set a map pin or ZIP before scheduling, or start from an accepted estimate.",
      409,
    );
  }
  return {
    serviceCents: quoted.serviceCents,
    travelFeeCents: quoted.travelFeeCents,
    totalCents: quoted.totalCents,
    priceLocked: quoted.priceLocked,
    estimateId: quoted.lockedFromEstimateId,
    lineItems:
      quoted.priceLocked && accepted
        ? accepted.lineItems
        : [{ description: input.title, amountCents: quoted.serviceCents }],
  };
}

function jobDetail(ctx: Ctx, actor: Actor, id: string) {
  const job = requireJob(ctx, id);
  const technicianIds = ctx.store.assignmentIds(id);
  assertCanSee(actor, technicianIds);
  const customer = requireCustomer(ctx, job.customerId);
  const address = requireAddress(ctx, job.addressId, customer.id);
  const beforePhotos = ctx.store.countPhotosByKind(id, "before");
  const afterPhotos = ctx.store.countPhotosByKind(id, "after");
  const card = ctx.store.getCard(customer.id);
  return {
    job,
    customer,
    address,
    technicianIds,
    technicians: ctx.store.listTechnicians().filter((technician) => technicianIds.includes(technician.id)),
    notes: ctx.store.listNotes(id),
    photos: ctx.store.listPhotoMeta(id),
    thread: threadFor(ctx, customer.id),
    changeOrders: ctx.store.listChangeOrders(id),
    audit: ctx.store.listAudit(id),
    photoUrl: job.shareToken ? photoPageUrl(ctx, job.shareToken) : null,
    invoice: ctx.store.latestInvoiceForJob(id),
    cardOnFile: card !== null,
    charge: chargeDecision({
      status: job.status,
      postWalkthroughComplete: job.postWalkthroughComplete,
      beforePhotos,
      afterPhotos,
      hasCard: card !== null,
    }),
  };
}

function threadFor(ctx: Ctx, customerId: string) {
  const titles = new Map(ctx.store.jobsForCustomer(customerId).map((job) => [job.id, job.title]));
  return ctx.store.listMessagesForCustomer(customerId).map((message) => ({
    ...message,
    jobTitle: titles.get(message.jobId) ?? "Job",
  }));
}

function notifyTarget(detail: ReturnType<typeof jobDetail>) {
  return {
    job: detail.job,
    customer: detail.customer,
    address: detail.address,
    technicianIds: detail.technicianIds,
  };
}

function scheduleOf(job: Job, walkthrough: boolean) {
  return {
    title: job.title,
    scheduledStart: job.scheduledStart,
    scheduledEnd: job.scheduledEnd,
    status: job.status,
    postWalkthroughComplete: walkthrough,
    unscheduled: job.unscheduled,
    arrivalStart: job.arrivalStart,
    arrivalEnd: job.arrivalEnd,
    accessNotes: job.accessNotes,
  };
}

function jobSnapshot(detail: ReturnType<typeof jobDetail>) {
  return {
    jobId: detail.job.id,
    title: detail.job.title,
    status: detail.job.status,
    totalCents: detail.job.totalCents,
    scheduledStart: detail.job.scheduledStart,
    opportunityId: detail.job.ghlOpportunityId,
  };
}

function requireJob(ctx: Ctx, id: string): Job {
  const job = ctx.store.getJob(id);
  if (!job) throw new AppError("not_found", "Job not found.", 404);
  return job;
}

function assertCanSee(actor: Actor, technicianIds: string[]): void {
  if (actor.role === "technician" && !technicianIds.includes(actor.technicianId)) {
    throw new AppError("forbidden", "That job is assigned to another crew.", 403);
  }
}

function assertCrew(ctx: Ctx, technicianIds: string[]): void {
  for (const id of technicianIds) {
    const technician = ctx.store.getTechnician(id);
    if (!technician?.active) throw new AppError("unknown_technician", "Choose an active crew member.", 400);
  }
}

function readIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new AppError("invalid_field", "Crew must be a list of ids.", 400);
  }
  return [...new Set(value)];
}

function readStatus(value: unknown): JobStatus {
  if (isJobStatus(value)) return value;
  throw new AppError("invalid_status", "Status must be scheduled, on my way, in progress, or done.", 400);
}

function readArrival(start: unknown, end: unknown): { start: string | null; end: string | null } {
  const arrivalStart = start === undefined || start === null || start === "" ? null : parseAppTime(start, "Arrival start");
  const arrivalEnd = end === undefined || end === null || end === "" ? null : parseAppTime(end, "Arrival end");
  if (arrivalStart && arrivalEnd && arrivalEnd <= arrivalStart) {
    throw new AppError("invalid_time", "The arrival window must end after it starts.", 400);
  }
  return { start: arrivalStart, end: arrivalEnd };
}

function readLineItems(body: Record<string, unknown>, title: string): LineItem[] {
  if (Array.isArray(body.lineItems)) {
    if (body.lineItems.length === 0) throw new AppError("invalid_amount", "Add at least one line item.", 400);
    return body.lineItems.map((item) => {
      if (!isRecord(item)) throw new AppError("invalid_amount", "Each line item needs a description and amount.", 400);
      return {
        description: cleanText(item.description, "Line item", 200),
        amountCents: assertCents(typeof item.amountCents === "number" ? item.amountCents : NaN, "Line item"),
      };
    });
  }
  if (typeof body.serviceCents === "number") {
    return [{ description: title, amountCents: assertCents(body.serviceCents, "Service price") }];
  }
  throw new AppError("invalid_amount", "Enter the service price in cents.", 400);
}

function readInitialStatus(value: unknown): JobStatus {
  if (value === undefined) return "scheduled";
  return readStatus(value);
}

function decodePhoto(value: unknown): Buffer {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError("invalid_photo", "The photo was empty.", 400);
  }
  const cleaned = value.replace(/^data:[^,]*,/, "").replace(/\s/g, "");
  const bytes = Buffer.from(cleaned, "base64");
  if (bytes.length === 0) throw new AppError("invalid_photo", "The photo was empty.", 400);
  if (bytes.length > 4_000_000) throw new AppError("invalid_photo", "Photos must be 4 MB or smaller.", 400);
  return bytes;
}
