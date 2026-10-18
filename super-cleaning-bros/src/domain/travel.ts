import { postalDigits } from "./normalize.ts";
import { POSTAL_CENTROIDS } from "./zips.ts";

export const ROAD_FACTOR = 1.3;
export const AVERAGE_SPEED_MPH = 35;
export const METERS_PER_MILE = 1609.344;
export const DEFAULT_TRAVEL_THRESHOLD_MILES = 35;
export const DEFAULT_TRAVEL_FEE_CENTS = 10_000;
const SAME_POSTAL_MINUTES = 12;

export type DriveBasis = "coordinates" | "postal_centroid" | "same_postal" | "google" | "unknown";

export type DriveEstimate = {
  minutes: number | null;
  basis: DriveBasis;
  distanceMiles: number | null;
};

export type TravelPolicy = {
  thresholdMiles: number;
  feeCents: number;
};

export type ShopOrigin = {
  lat: number;
  lng: number;
  postalCode: string;
};

const EARTH_MILES = 3958.8;

export function haversineMiles(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.lat - from.lat);
  const longitudeDelta = toRadians(to.lng - from.lng);
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function minutesForStraightLineMiles(straightMiles: number): number {
  if (straightMiles <= 0) return 0;
  return (straightMiles * ROAD_FACTOR * 60) / AVERAGE_SPEED_MPH;
}

/** $100 when the road distance is more than the threshold. Exactly the threshold is no fee. */
export function travelFeeForMiles(
  miles: number | null,
  policy: TravelPolicy,
): { feeCents: number; reviewRequired: boolean } {
  if (miles === null || !Number.isFinite(miles)) {
    return { feeCents: 0, reviewRequired: true };
  }
  if (miles > policy.thresholdMiles) {
    return { feeCents: policy.feeCents, reviewRequired: false };
  }
  return { feeCents: 0, reviewRequired: false };
}

export function estimateDriveOffline(
  shop: ShopOrigin,
  address: { lat: number | null; lng: number | null; postalCode: string },
): DriveEstimate {
  if (
    address.lat !== null &&
    address.lng !== null &&
    Number.isFinite(address.lat) &&
    Number.isFinite(address.lng)
  ) {
    const straightMiles = haversineMiles(shop, { lat: address.lat, lng: address.lng });
    return driveFromStraightMiles(straightMiles, "coordinates");
  }
  const postal = postalDigits(address.postalCode);
  if (postal !== "" && postal === postalDigits(shop.postalCode)) {
    return { minutes: SAME_POSTAL_MINUTES, basis: "same_postal", distanceMiles: 0 };
  }
  const centroid = POSTAL_CENTROIDS[postal];
  if (centroid) {
    return driveFromStraightMiles(haversineMiles(shop, centroid), "postal_centroid");
  }
  return { minutes: null, basis: "unknown", distanceMiles: null };
}

function driveFromStraightMiles(straightMiles: number, basis: "coordinates" | "postal_centroid"): DriveEstimate {
  return {
    minutes: roundTenth(minutesForStraightLineMiles(straightMiles)),
    basis,
    distanceMiles: roundTenth(straightMiles * ROAD_FACTOR),
  };
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * An accepted customer price is the amount they pay. A computed travel fee is
 * shown inside that total when it fits, and is not added on top.
 */
export function splitAcceptedTotal(
  totalCents: number,
  computedTravelFeeCents: number,
): { serviceCents: number; travelFeeCents: number; totalCents: number } {
  if (computedTravelFeeCents > 0 && computedTravelFeeCents <= totalCents) {
    return {
      serviceCents: totalCents - computedTravelFeeCents,
      travelFeeCents: computedTravelFeeCents,
      totalCents,
    };
  }
  return { serviceCents: totalCents, travelFeeCents: 0, totalCents };
}
