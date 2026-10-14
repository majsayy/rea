import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type { AppConfig } from "../config.ts";
import { ensureDatabaseDirectory, ghlConfigured } from "../config.ts";
import { migrate } from "../db/schema.ts";
import { Store } from "../db/store.ts";
import { FallbackDriveTime, GoogleDriveTime, OfflineDriveTime, type DriveTimePort } from "../drive/driveTime.ts";
import { HttpGhlClient, type GhlClient } from "../ghl/client.ts";
import { ManualPaymentProvider } from "../payments/manual.ts";
import type { PaymentProvider } from "../payments/provider.ts";
import { StripeGateway } from "../payments/stripe.ts";

export type Ctx = {
  config: AppConfig;
  store: Store;
  driveTime: DriveTimePort;
  payments: PaymentProvider;
  stripe: StripeGateway | null;
  ghl: GhlClient | null;
};

export function buildContext(options: {
  config: AppConfig;
  now?: () => Date;
  id?: () => string;
  fetchImpl?: typeof fetch;
  payments?: PaymentProvider;
  ghl?: GhlClient | null;
  driveTime?: DriveTimePort;
}): { ctx: Ctx; close: () => void } {
  const fetchImpl = options.fetchImpl ?? fetch;
  ensureDatabaseDirectory(options.config.databasePath);
  const db = new DatabaseSync(options.config.databasePath);
  if (options.config.databasePath !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  const store = new Store(db, options.now ?? (() => new Date()), options.id ?? (() => randomUUID()));
  const offline = new OfflineDriveTime(options.config.shop);
  const driveTime =
    options.driveTime ??
    (options.config.googleMapsApiKey
      ? new FallbackDriveTime(new GoogleDriveTime(options.config.shop, options.config.googleMapsApiKey, fetchImpl), offline)
      : offline);
  const stripe = options.config.stripe.secretKey
    ? new StripeGateway(options.config.stripe.secretKey, fetchImpl)
    : null;
  const payments = options.payments ?? stripe ?? new ManualPaymentProvider();
  const ghl =
    options.ghl === undefined
      ? ghlConfigured(options.config)
        ? new HttpGhlClient({
            token: options.config.ghl.token ?? "",
            locationId: options.config.ghl.locationId ?? "",
            apiBase: options.config.ghl.apiBase,
            apiVersion: options.config.ghl.apiVersion,
            userId: options.config.ghl.userId,
            fetchImpl,
          })
        : null
      : options.ghl;
  return {
    ctx: { config: options.config, store, driveTime, payments, stripe, ghl },
    close: () => store.close(),
  };
}
