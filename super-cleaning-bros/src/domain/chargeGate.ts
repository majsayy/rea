export type ChargeJobState = {
  status: "scheduled" | "in_progress" | "done";
  postWalkthroughComplete: boolean;
  beforePhotos: number;
  afterPhotos: number;
  hasCard: boolean;
};

const MESSAGES = {
  no_card_on_file: "Save a card on file before charging. The card number stays with the payment provider.",
  job_not_done: "The card on file is not charged until the job is done.",
  completion_evidence_missing:
    "Finish the post-job walkthrough, or add both a before photo and an after photo, before charging the card.",
} as const;

export type ChargeBlockReason = keyof typeof MESSAGES;

export function chargeBlockReason(input: ChargeJobState): ChargeBlockReason | null {
  if (!input.hasCard) return "no_card_on_file";
  if (input.status !== "done") return "job_not_done";
  const photosReady = input.beforePhotos > 0 && input.afterPhotos > 0;
  if (!input.postWalkthroughComplete && !photosReady) return "completion_evidence_missing";
  return null;
}

export function chargeDecision(
  input: ChargeJobState,
): { ok: true } | { ok: false; reason: ChargeBlockReason; message: string } {
  const reason = chargeBlockReason(input);
  if (!reason) return { ok: true };
  return { ok: false, reason, message: MESSAGES[reason] };
}
