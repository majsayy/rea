import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { AppError } from "./domain/errors.ts";

export type AppConfig = {
  port: number;
  databasePath: string;
  publicBaseUrl: string;
  shop: { name: string; postalCode: string; lat: number; lng: number };
  travel: { thresholdMiles: number; feeCents: number };
  mondayTextReleaseTime: string;
  auth: {
    required: boolean;
    officePassword: string | null;
    sessionSecret: string | null;
    secureCookies: boolean;
  };
  ghl: {
    token: string | null;
    locationId: string | null;
    apiBase: string;
    apiVersion: string;
    webhookSecret: string | null;
    userId: string | null;
    stageScheduled: string | null;
    stageInProgress: string | null;
    stageDone: string | null;
    stageInvoiced: string | null;
    stagePaid: string | null;
    stageOnMyWay: string | null;
    emailFrom: string | null;
    reviewUrl: string | null;
    photoLinkFieldId: string | null;
  };
  stripe: { secretKey: string | null; webhookSecret: string | null };
  googleMapsApiKey: string | null;
};

function blank(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function integer(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new AppError("invalid_config", `${label} must be a whole number.`, 500);
  }
  return parsed;
}

function clockTime(value: string | undefined, fallback: string, label: string): string {
  const text = value === undefined || value.trim() === "" ? fallback : value.trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    throw new AppError("invalid_config", `${label} must be a time like 08:00 in America/Denver.`, 500);
  }
  return text;
}

function coordinate(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError("invalid_config", `${label} must be a number.`, 500);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv, cwd = process.cwd()): AppConfig {
  const officePassword = blank(env.OFFICE_PASSWORD);
  const sessionSecret = blank(env.SESSION_SECRET);
  if (officePassword && (!sessionSecret || sessionSecret.length < 16)) {
    throw new AppError(
      "invalid_config",
      "SESSION_SECRET must be at least 16 characters when OFFICE_PASSWORD is set.",
      500,
    );
  }
  const requestedDatabase = env.DATABASE_PATH?.trim() || "./data/scb.sqlite";
  const databasePath = requestedDatabase === ":memory:" ? requestedDatabase : resolve(cwd, requestedDatabase);
  const publicBaseUrl = (blank(env.PUBLIC_BASE_URL) ?? "http://localhost:8787").replace(/\/$/, "");
  return {
    port: integer(env.PORT, 8787, "PORT"),
    databasePath,
    publicBaseUrl,
    shop: {
      name: "Super Cleaning Bros",
      postalCode: blank(env.SHOP_POSTAL_CODE) ?? "80516",
      lat: coordinate(env.SHOP_LAT, 40.0503, "SHOP_LAT"),
      lng: coordinate(env.SHOP_LNG, -105.0497, "SHOP_LNG"),
    },
    travel: {
      thresholdMiles: integer(env.TRAVEL_THRESHOLD_MILES, 35, "TRAVEL_THRESHOLD_MILES"),
      feeCents: integer(env.TRAVEL_FEE_CENTS, 10_000, "TRAVEL_FEE_CENTS"),
    },
    mondayTextReleaseTime: clockTime(env.MONDAY_TEXT_RELEASE_TIME, "08:00", "MONDAY_TEXT_RELEASE_TIME"),
    auth: {
      required: officePassword !== null,
      officePassword,
      sessionSecret,
      secureCookies: publicBaseUrl.startsWith("https://"),
    },
    ghl: {
      token: blank(env.GHL_PRIVATE_TOKEN),
      locationId: blank(env.GHL_LOCATION_ID),
      apiBase: (blank(env.GHL_API_BASE) ?? "https://services.leadconnectorhq.com").replace(/\/$/, ""),
      apiVersion: blank(env.GHL_API_VERSION) ?? "2021-07-28",
      webhookSecret: blank(env.GHL_WEBHOOK_SECRET),
      userId: blank(env.GHL_USER_ID),
      stageScheduled: blank(env.GHL_STAGE_SCHEDULED),
      stageInProgress: blank(env.GHL_STAGE_IN_PROGRESS),
      stageDone: blank(env.GHL_STAGE_DONE),
      stageInvoiced: blank(env.GHL_STAGE_INVOICED),
      stagePaid: blank(env.GHL_STAGE_PAID),
      stageOnMyWay: blank(env.GHL_STAGE_ON_MY_WAY),
      emailFrom: blank(env.GHL_EMAIL_FROM),
      reviewUrl: blank(env.REVIEW_URL),
      photoLinkFieldId: blank(env.GHL_PHOTO_LINK_FIELD_ID),
    },
    stripe: {
      secretKey: blank(env.STRIPE_SECRET_KEY),
      webhookSecret: blank(env.STRIPE_WEBHOOK_SECRET),
    },
    googleMapsApiKey: blank(env.GOOGLE_MAPS_API_KEY),
  };
}

export function ensureDatabaseDirectory(databasePath: string): void {
  if (databasePath === ":memory:") return;
  mkdirSync(dirname(databasePath), { recursive: true });
}

export function ghlConfigured(config: AppConfig): boolean {
  return config.ghl.token !== null && config.ghl.locationId !== null;
}
