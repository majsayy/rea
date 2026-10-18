import { AppError, isRecord } from "../domain/errors.ts";
import { addressKey, displayName, normalizePhone, postalDigits } from "../domain/normalize.ts";

export type AddressDraft = {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
  addressKey: string;
};

export function cleanText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new AppError("invalid_field", `${label} is required.`, 400);
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) throw new AppError("invalid_field", `${label} is required.`, 400);
  if (text.length > max) throw new AppError("invalid_field", `${label} is too long.`, 400);
  return text;
}

export function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return cleanText(value, label, max);
}

export function cleanMultiline(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new AppError("invalid_field", `${label} is required.`, 400);
  const text = value.replace(/\r\n/g, "\n").trim();
  if (!text) throw new AppError("invalid_field", `${label} is required.`, 400);
  if (text.length > max) throw new AppError("invalid_field", `${label} is too long.`, 400);
  return text;
}

export function cleanEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new AppError("invalid_field", "Email is invalid.", 400);
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("invalid_field", "Email is invalid.", 400);
  }
  return email;
}

export function cleanPhone(value: unknown, required: boolean): string {
  if (typeof value !== "string") {
    if (!required) return "";
    throw new AppError("invalid_field", "Phone is required.", 400);
  }
  const phone = normalizePhone(value);
  if (phone.length >= 10) return phone;
  if (!required && phone.length === 0) return "";
  throw new AppError("invalid_field", "Enter a 10-digit phone number.", 400);
}

export function cleanAddress(value: unknown): AddressDraft | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new AppError("invalid_field", "Address is invalid.", 400);
  const line1 = cleanText(value.line1 ?? value.address1, "Street address", 200);
  const line2 = optionalText(value.line2, "Address line 2", 200);
  const city = optionalText(value.city, "City", 80) ?? "";
  const stateRaw = optionalText(value.state, "State", 40) ?? "";
  const state = /^[A-Za-z]{2}$/.test(stateRaw) ? stateRaw.toUpperCase() : stateRaw.slice(0, 2).toUpperCase();
  const postalCode = postalDigits(String(value.postalCode ?? value.postal_code ?? value.zip ?? ""));
  if (!postalCode) throw new AppError("invalid_field", "ZIP code is required.", 400);
  return {
    line1,
    line2,
    city,
    state,
    postalCode,
    lat: coordinate(value.lat, "Latitude"),
    lng: coordinate(value.lng, "Longitude"),
    addressKey: addressKey({ line1, line2, city, state, postalCode }),
  };
}

export function personName(value: unknown, label: string, required: boolean): string {
  if (!required && (value === undefined || value === null || value === "")) return "";
  return displayName(cleanText(value, label, 80));
}

function coordinate(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < -180 || parsed > 180) {
    throw new AppError("invalid_field", `${label} is not a coordinate.`, 400);
  }
  return parsed;
}
