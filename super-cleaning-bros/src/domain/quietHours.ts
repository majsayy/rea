import { isDenverSunday, nextMondayReleaseIso } from "./time.ts";

export type QuietDecision =
  | { kind: "send" }
  | { kind: "skip"; detail: "sunday_not_useful" }
  | { kind: "hold"; sendAfter: string };

/**
 * Sunday texts in America/Denver.
 * On my way and started are skipped: a Monday "on the way" text about Sunday is wrong.
 * Finished and review are held for Monday morning: the thank-you still makes sense.
 * A reschedule is held when the new visit is still ahead of that Monday release, and
 * skipped when the visit time has already passed by then.
 * Photo emails and anything that is not one of these texts are left to the caller.
 */
export function quietHoursDecision(input: {
  now: Date;
  trigger: string;
  scheduledStart: string | null;
  releaseTime: string;
}): QuietDecision {
  if (!isDenverSunday(input.now)) return { kind: "send" };
  if (input.trigger === "on_my_way" || input.trigger === "started") {
    return { kind: "skip", detail: "sunday_not_useful" };
  }
  if (input.trigger === "finished" || input.trigger === "review") {
    return { kind: "hold", sendAfter: nextMondayReleaseIso(input.now, input.releaseTime) };
  }
  if (input.trigger === "reschedule") {
    const sendAfter = nextMondayReleaseIso(input.now, input.releaseTime);
    if (input.scheduledStart !== null && input.scheduledStart <= sendAfter) {
      return { kind: "skip", detail: "sunday_not_useful" };
    }
    return { kind: "hold", sendAfter };
  }
  return { kind: "send" };
}
