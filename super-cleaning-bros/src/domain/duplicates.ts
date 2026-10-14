import { normalizeMatchName, normalizePhone } from "./normalize.ts";

export type MatchCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  addressKeys: string[];
};

export type DuplicateMatch = {
  id: string;
  matchedOn: Array<"phone" | "address">;
};

/**
 * A duplicate is the same last name plus either the same phone or the same
 * address. First name is never enough, even when it is the only thing in common.
 */
export function findDuplicate(
  existing: readonly MatchCandidate[],
  incoming: { lastName: string; phone: string; addressKeys: readonly string[] },
): DuplicateMatch | null {
  const lastName = normalizeMatchName(incoming.lastName);
  if (!lastName) return null;
  const phone = normalizePhone(incoming.phone);
  const keys = new Set(incoming.addressKeys.filter((key) => key.length > 0));
  for (const candidate of existing) {
    if (normalizeMatchName(candidate.lastName) !== lastName) continue;
    const matchedOn: Array<"phone" | "address"> = [];
    const candidatePhone = normalizePhone(candidate.phone);
    if (phone.length >= 10 && candidatePhone.length >= 10 && candidatePhone === phone) {
      matchedOn.push("phone");
    }
    if (candidate.addressKeys.some((key) => keys.has(key))) matchedOn.push("address");
    if (matchedOn.length > 0) return { id: candidate.id, matchedOn };
  }
  return null;
}
