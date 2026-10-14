import { AppError, isRecord } from "../domain/errors.ts";
import { hashSecret, verifySecret } from "../auth/secrets.ts";
import type { Actor } from "./actors.ts";
import { assertOffice } from "./actors.ts";
import type { Ctx } from "./context.ts";
import { cleanPhone, cleanText, optionalText } from "./validate.ts";

export function listTechnicians(ctx: Ctx, actor: Actor) {
  assertOffice(actor);
  return ctx.store.listTechnicians();
}

export function createTechnician(ctx: Ctx, actor: Actor, body: unknown) {
  assertOffice(actor);
  if (!isRecord(body)) throw new AppError("invalid_field", "Crew details are required.", 400);
  const name = cleanText(body.name, "Name", 80);
  const phone = body.phone ? cleanPhone(body.phone, false) : null;
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (pin.length < 4 || pin.length > 12) {
    throw new AppError("invalid_field", "Choose a PIN between 4 and 12 characters.", 400);
  }
  return ctx.store.insertTechnician({
    name,
    phone: phone || optionalText(body.phone, "Phone", 20),
    pinHash: hashSecret(pin),
  });
}

export function loginTechnician(ctx: Ctx, name: string, pin: string): Actor | null {
  const technician = ctx.store.findTechnicianByName(name.trim());
  if (!technician || !verifySecret(pin, technician.pinHash)) return null;
  return { role: "technician", technicianId: technician.id, name: technician.name };
}
