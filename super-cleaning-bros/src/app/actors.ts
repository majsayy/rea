import { AppError } from "../domain/errors.ts";

export type Actor =
  | { role: "office"; name: string }
  | { role: "technician"; technicianId: string; name: string }
  | { role: "system"; name: string };

export function assertOffice(actor: Actor): void {
  if (actor.role === "technician") {
    throw new AppError("forbidden", "Office access is required.", 403);
  }
}

export function authorName(actor: Actor): string {
  return actor.name;
}
