import type { DriveEstimate } from "../domain/travel.ts";
import { METERS_PER_MILE, estimateDriveOffline, type ShopOrigin } from "../domain/travel.ts";
import { isRecord } from "../domain/errors.ts";

export type DriveAddress = {
  lat: number | null;
  lng: number | null;
  postalCode: string;
};

export interface DriveTimePort {
  estimate(address: DriveAddress): Promise<DriveEstimate>;
}

export class OfflineDriveTime implements DriveTimePort {
  constructor(private readonly shop: ShopOrigin) {}

  estimate(address: DriveAddress): Promise<DriveEstimate> {
    return Promise.resolve(estimateDriveOffline(this.shop, address));
  }
}

export class GoogleDriveTime implements DriveTimePort {
  constructor(
    private readonly shop: ShopOrigin,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async estimate(address: DriveAddress): Promise<DriveEstimate> {
    const destination =
      address.lat !== null && address.lng !== null
        ? `${address.lat},${address.lng}`
        : address.postalCode;
    const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
    url.searchParams.set("origins", `${this.shop.lat},${this.shop.lng}`);
    url.searchParams.set("destinations", destination);
    url.searchParams.set("units", "imperial");
    url.searchParams.set("key", this.apiKey);
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`Google Distance Matrix returned ${response.status}`);
    const body: unknown = await response.json();
    const element = readElement(body);
    const meters = element ? readNumber(element.distance) : null;
    if (meters === null) throw new Error("Google Distance Matrix did not return a distance");
    const seconds = element ? readNumber(element.duration) : null;
    return {
      minutes: seconds === null ? null : Math.round((seconds / 60) * 10) / 10,
      basis: "google",
      distanceMiles: Math.round((meters / METERS_PER_MILE) * 10) / 10,
    };
  }
}

export class FallbackDriveTime implements DriveTimePort {
  constructor(
    private readonly primary: DriveTimePort,
    private readonly fallback: DriveTimePort,
  ) {}

  async estimate(address: DriveAddress): Promise<DriveEstimate> {
    try {
      return await this.primary.estimate(address);
    } catch {
      return this.fallback.estimate(address);
    }
  }
}

function readElement(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body) || !Array.isArray(body.rows)) return null;
  const row = body.rows[0];
  if (!isRecord(row) || !Array.isArray(row.elements)) return null;
  const element = row.elements[0];
  if (!isRecord(element) || element.status !== "OK") return null;
  return element;
}

function readNumber(value: unknown): number | null {
  if (!isRecord(value)) return null;
  return typeof value.value === "number" ? value.value : null;
}
