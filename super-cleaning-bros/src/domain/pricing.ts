export type PriceParts = {
  serviceCents: number;
  travelFeeCents: number;
  totalCents: number;
};

export type AcceptedPrice = PriceParts & { estimateId: string };

export type QuotedPrice = PriceParts & {
  priceLocked: boolean;
  lockedFromEstimateId: string | null;
};

/**
 * Once a customer has accepted a price for a property, later rate-card numbers
 * do not replace it. Travel is not stacked on top of that accepted total.
 */
export function applyAcceptedPrice(input: {
  accepted: AcceptedPrice | null;
  calculated: PriceParts;
}): QuotedPrice {
  if (input.accepted) {
    return {
      serviceCents: input.accepted.serviceCents,
      travelFeeCents: input.accepted.travelFeeCents,
      totalCents: input.accepted.totalCents,
      priceLocked: true,
      lockedFromEstimateId: input.accepted.estimateId,
    };
  }
  return {
    serviceCents: input.calculated.serviceCents,
    travelFeeCents: input.calculated.travelFeeCents,
    totalCents: input.calculated.totalCents,
    priceLocked: false,
    lockedFromEstimateId: null,
  };
}
