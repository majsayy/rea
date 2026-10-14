import { AppError } from "./errors.ts";

export function assertCents(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000_00) {
    throw new AppError(
      "invalid_amount",
      `${label} must be a whole number of cents from 0 to 100000000.`,
      400,
    );
  }
  return value;
}

export function dollarsToCents(value: string): number {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new AppError(
      "invalid_amount",
      `Could not read the dollar amount "${value}".`,
      400,
    );
  }
  const [whole, fraction = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return assertCents(cents, "Amount");
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  return `${sign}$${dollars}.${String(remainder).padStart(2, "0")}`;
}
