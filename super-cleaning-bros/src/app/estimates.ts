import type { Estimate, LineItem } from "../domain/types.ts";
import { AppError, isRecord } from "../domain/errors.ts";
import { assertCents } from "../domain/money.ts";
import { applyAcceptedPrice } from "../domain/pricing.ts";
import { travelFeeForMinutes } from "../domain/travel.ts";
import type { Actor } from "./actors.ts";
import { assertOffice } from "./actors.ts";
import type { Ctx } from "./context.ts";
import { requireAddress, requireCustomer } from "../ghl/outbound.ts";
import { cleanText } from "./validate.ts";

export async function createEstimate(ctx: Ctx, actor: Actor, body: unknown): Promise<Estimate> {
  assertOffice(actor);
  if (!isRecord(body)) throw new AppError("invalid_field", "Estimate details are required.", 400);
  const customer = requireCustomer(ctx, String(body.customerId ?? ""));
  const address = requireAddress(ctx, String(body.addressId ?? ""), customer.id);
  const lineItems = readLineItems(body);
  const serviceCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);
  const drive = await ctx.driveTime.estimate(address);
  const travel = travelFeeForMinutes(drive.minutes, ctx.config.travel);
  const prior = ctx.store.latestAcceptedEstimate(customer.id, address.id);
  const quoted = applyAcceptedPrice({
    accepted: prior
      ? {
          estimateId: prior.id,
          serviceCents: prior.serviceCents,
          travelFeeCents: prior.travelFeeCents,
          totalCents: prior.totalCents,
        }
      : null,
    calculated: {
      serviceCents,
      travelFeeCents: travel.feeCents,
      totalCents: serviceCents + travel.feeCents,
    },
  });
  return ctx.store.insertEstimate({
    customerId: customer.id,
    addressId: address.id,
    status: "draft",
    serviceCents: quoted.serviceCents,
    travelFeeCents: quoted.travelFeeCents,
    totalCents: quoted.totalCents,
    driveMinutes: prior?.driveMinutes ?? drive.minutes,
    travelBasis: prior?.travelBasis ?? drive.basis,
    travelReviewRequired: quoted.priceLocked ? false : travel.reviewRequired,
    priceLocked: quoted.priceLocked,
    lockedFromEstimateId: quoted.lockedFromEstimateId,
    lineItems: quoted.priceLocked && prior ? prior.lineItems : lineItems,
  });
}

export function acceptEstimate(ctx: Ctx, actor: Actor, id: string): Estimate {
  assertOffice(actor);
  const estimate = requireEstimate(ctx, id);
  if (estimate.status === "accepted") return estimate;
  if (estimate.status === "declined") {
    throw new AppError("estimate_declined", "This estimate was declined.", 409);
  }
  if (estimate.travelReviewRequired) {
    throw new AppError(
      "travel_review_required",
      "Drive time from Erie is still unknown. Add a map location or a known ZIP before accepting the price.",
      409,
    );
  }
  ctx.store.markEstimate(id, "accepted", ctx.store.now().toISOString());
  return requireEstimate(ctx, id);
}

export function declineEstimate(ctx: Ctx, actor: Actor, id: string): Estimate {
  assertOffice(actor);
  const estimate = requireEstimate(ctx, id);
  if (estimate.status === "accepted") {
    throw new AppError("price_locked", "An accepted price stays accepted.", 409);
  }
  ctx.store.markEstimate(id, "declined", null);
  return requireEstimate(ctx, id);
}

export function listEstimates(ctx: Ctx, actor: Actor) {
  assertOffice(actor);
  return ctx.store.listEstimates().map((estimate) => {
    const customer = ctx.store.getCustomer(estimate.customerId);
    return {
      ...estimate,
      customerName: customer ? `${customer.firstName} ${customer.lastName}`.trim() : "Customer",
    };
  });
}

function requireEstimate(ctx: Ctx, id: string): Estimate {
  const estimate = ctx.store.getEstimate(id);
  if (!estimate) throw new AppError("not_found", "Estimate not found.", 404);
  return estimate;
}

function readLineItems(body: Record<string, unknown>): LineItem[] {
  if (Array.isArray(body.lineItems)) {
    const items = body.lineItems.map((item, index) => {
      if (!isRecord(item)) throw new AppError("invalid_amount", "Line item is invalid.", 400);
      return {
        description: cleanText(item.description, `Line ${index + 1}`, 200),
        amountCents: assertCents(Number(item.amountCents), `Line ${index + 1}`),
      };
    });
    if (items.length === 0) throw new AppError("invalid_amount", "Add at least one line.", 400);
    return items;
  }
  const description = cleanText(body.description ?? "Cleaning", "Description", 200);
  const amount = body.serviceCents ?? body.amountCents;
  if (typeof amount !== "number") {
    throw new AppError("invalid_amount", "Enter a service price in cents.", 400);
  }
  return [{ description, amountCents: assertCents(amount, "Service price") }];
}
