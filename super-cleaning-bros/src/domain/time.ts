import { AppError } from "./errors.ts";

function denverOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(instant);
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) {
    throw new AppError("invalid_time", "Could not resolve America/Denver.", 500);
  }
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? "0"));
}

/** Interpret a clock reading in America/Denver and return UTC ISO. */
export function denverLocalToUtc(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new AppError("invalid_time", "Use a date and time like 2026-10-20T09:00.", 400);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new AppError("invalid_time", "That date and time is not real.", 400);
  }
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const firstOffset = denverOffsetMinutes(guess);
  let utc = new Date(guess.getTime() - firstOffset * 60_000);
  const secondOffset = denverOffsetMinutes(utc);
  if (secondOffset !== firstOffset) {
    utc = new Date(guess.getTime() - secondOffset * 60_000);
  }
  return utc.toISOString();
}

export function isDenverSunday(instant: Date): boolean {
  return denverWeekday(instant) === "Sun";
}

export function denverDateKey(instant: Date): string {
  const { year, month, day } = denverDateParts(instant);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Monday morning after a Sunday, as a UTC ISO instant. `releaseTime` is HH:MM in America/Denver. */
export function nextMondayReleaseIso(sunday: Date, releaseTime: string): string {
  const { year, month, day } = denverDateParts(sunday);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const date = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
  return denverLocalToUtc(`${date}T${releaseTime}`);
}

function denverWeekday(instant: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short" }).format(instant);
}

function denverDateParts(instant: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDenver(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** A calendar date starts at midnight in America/Denver. */
export function parseRangeStart(value: string, label: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return denverLocalToUtc(`${value.trim()}T00:00`);
  return parseAppTime(value, label);
}

export function parseAppTime(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError("invalid_time", `${label} is required.`, 400);
  }
  const text = value.trim();
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(text)) {
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError("invalid_time", `${label} is not a real date.`, 400);
    }
    return parsed.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return denverLocalToUtc(`${text}T09:00`);
  try {
    return denverLocalToUtc(text);
  } catch (error) {
    if (error instanceof AppError && error.code === "invalid_time") {
      throw new AppError("invalid_time", `${label} must be a date and time.`, 400);
    }
    throw error;
  }
}
