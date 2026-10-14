import type { JobStatus, LineItem } from "./types.ts";
import { assertCents } from "./money.ts";

export type PricedLines = {
  lineItems: LineItem[];
  serviceCents: number;
  travelFeeCents: number;
  totalCents: number;
};

export function priceLines(lineItems: LineItem[], travelFeeCents: number): PricedLines {
  const serviceCents = lineItems.reduce((sum, item) => sum + assertCents(item.amountCents, "Line item"), 0);
  assertCents(serviceCents, "Service price");
  const travel = assertCents(travelFeeCents, "Travel fee");
  return {
    lineItems,
    serviceCents,
    travelFeeCents: travel,
    totalCents: assertCents(serviceCents + travel, "Job total"),
  };
}

/**
 * An unlocked job that is still scheduled can be edited directly.
 * A locked price, or any job the crew has already left "scheduled",
 * stays put until the office approves a change order.
 * An explicit customer-approved change order applies immediately and is logged as such.
 */
export function planPriceChange(input: {
  priceLocked: boolean;
  status: JobStatus;
  customerApproved: boolean;
  travelFeeCents: number;
  nextLineItems: LineItem[];
}): { mode: "apply" | "pending"; customerApproved: boolean; next: PricedLines } {
  const next = priceLines(input.nextLineItems, input.travelFeeCents);
  const direct = !input.priceLocked && input.status === "scheduled";
  if (direct || input.customerApproved) {
    return { mode: "apply", customerApproved: input.customerApproved, next };
  }
  return { mode: "pending", customerApproved: false, next };
}
