import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chargeDecision } from "../src/domain/chargeGate.ts";
import { denverLocalToUtc, parseAppTime } from "../src/domain/time.ts";
import { quietHoursDecision } from "../src/domain/quietHours.ts";
import { nextMondayReleaseIso } from "../src/domain/time.ts";
import {
  estimateDriveOffline,
  travelFeeForMiles,
} from "../src/domain/travel.ts";
import { applyAcceptedPrice } from "../src/domain/pricing.ts";
import { buildReport } from "../src/domain/reporting.ts";
import { csvRecords } from "../src/domain/csv.ts";

const shop = { lat: 40.0503, lng: -105.0497, postalCode: "80516" };
const policy = { thresholdMiles: 35, feeCents: 10_000 };

describe("travel fee from Erie 80516", () => {
  it("charges $100 only when the drive is longer than 35 miles", () => {
    assert.equal(travelFeeForMiles(35, policy).feeCents, 0);
    assert.equal(travelFeeForMiles(35.1, policy).feeCents, 10_000);
    assert.equal(travelFeeForMiles(null, policy).reviewRequired, true);
  });

  it("treats 80516 and Denver as in range and Fort Collins as a travel job", () => {
    const erie = estimateDriveOffline(shop, { lat: null, lng: null, postalCode: "80516" });
    const denver = estimateDriveOffline(shop, { lat: null, lng: null, postalCode: "80202" });
    const fortCollins = estimateDriveOffline(shop, { lat: null, lng: null, postalCode: "80525" });
    const unknown = estimateDriveOffline(shop, { lat: null, lng: null, postalCode: "99999" });
    assert.equal(erie.distanceMiles, 0);
    assert.equal(travelFeeForMiles(erie.distanceMiles, policy).feeCents, 0);
    assert.ok((denver.distanceMiles ?? 99) <= 35);
    assert.equal(travelFeeForMiles(denver.distanceMiles, policy).feeCents, 0);
    assert.ok((fortCollins.distanceMiles ?? 0) > 35);
    assert.equal(travelFeeForMiles(fortCollins.distanceMiles, policy).feeCents, 10_000);
    assert.equal(travelFeeForMiles(unknown.distanceMiles, policy).reviewRequired, true);
  });

  it("uses coordinates when a map pin is present", () => {
    const near = estimateDriveOffline(shop, {
      lat: shop.lat + 5 / 69,
      lng: shop.lng,
      postalCode: "99999",
    });
    const far = estimateDriveOffline(shop, {
      lat: shop.lat + 40 / 69,
      lng: shop.lng,
      postalCode: "99999",
    });
    assert.equal(travelFeeForMiles(near.distanceMiles, policy).feeCents, 0);
    assert.equal(travelFeeForMiles(far.distanceMiles, policy).feeCents, 10_000);
    assert.equal(far.basis, "coordinates");
  });
});

describe("Sunday texts", () => {
  const sunday = new Date("2026-10-18T15:00:00.000Z");
  const wednesday = new Date("2026-10-14T15:00:00.000Z");

  it("releases held texts at the configured Monday morning", () => {
    assert.equal(nextMondayReleaseIso(sunday, "08:00"), "2026-10-19T14:00:00.000Z");
  });

  it("skips texts that would be stale and holds the ones that still make sense", () => {
    const release = "08:00";
    assert.equal(quietHoursDecision({ now: wednesday, trigger: "on_my_way", scheduledStart: null, releaseTime: release }).kind, "send");
    assert.equal(quietHoursDecision({ now: sunday, trigger: "on_my_way", scheduledStart: null, releaseTime: release }).kind, "skip");
    assert.equal(quietHoursDecision({ now: sunday, trigger: "started", scheduledStart: null, releaseTime: release }).kind, "skip");
    assert.equal(quietHoursDecision({ now: sunday, trigger: "finished", scheduledStart: null, releaseTime: release }).kind, "hold");
    assert.equal(quietHoursDecision({ now: sunday, trigger: "review", scheduledStart: null, releaseTime: release }).kind, "hold");
    const passed = quietHoursDecision({
      now: sunday,
      trigger: "reschedule",
      scheduledStart: "2026-10-18T20:00:00.000Z",
      releaseTime: release,
    });
    assert.equal(passed.kind, "skip");
    const later = quietHoursDecision({
      now: sunday,
      trigger: "reschedule",
      scheduledStart: "2026-10-19T16:00:00.000Z",
      releaseTime: release,
    });
    assert.equal(later.kind, "hold");
    assert.equal(quietHoursDecision({ now: sunday, trigger: "photos", scheduledStart: null, releaseTime: release }).kind, "send");
  });
});

describe("accepted prices", () => {
  it("keeps the accepted total when the rate card is higher", () => {
    const quoted = applyAcceptedPrice({
      accepted: { estimateId: "est_1", serviceCents: 18_000, travelFeeCents: 0, totalCents: 18_000 },
      calculated: { serviceCents: 25_000, travelFeeCents: 10_000, totalCents: 35_000 },
    });
    assert.equal(quoted.totalCents, 18_000);
    assert.equal(quoted.priceLocked, true);
    assert.equal(quoted.lockedFromEstimateId, "est_1");
  });
});

describe("card charge gate", () => {
  const ready = {
    status: "done" as const,
    postWalkthroughComplete: false,
    beforePhotos: 1,
    afterPhotos: 1,
    hasCard: true,
  };

  it("blocks the card until the job is done and completion evidence exists", () => {
    assert.equal(chargeDecision({ ...ready, hasCard: false }).ok, false);
    assert.equal(chargeDecision({ ...ready, status: "scheduled" }).ok, false);
    assert.equal(chargeDecision({ ...ready, status: "in_progress", beforePhotos: 0, afterPhotos: 0 }).ok, false);
    assert.equal(chargeDecision({ ...ready, beforePhotos: 1, afterPhotos: 0 }).ok, false);
    assert.equal(chargeDecision(ready).ok, true);
    assert.equal(
      chargeDecision({ ...ready, beforePhotos: 0, afterPhotos: 0, postWalkthroughComplete: true }).ok,
      true,
    );
  });
});

describe("Denver schedule times", () => {
  it("reads shop times as America/Denver", () => {
    assert.equal(denverLocalToUtc("2026-10-20T09:00"), "2026-10-20T15:00:00.000Z");
    assert.equal(denverLocalToUtc("2026-01-20T09:00"), "2026-01-20T16:00:00.000Z");
    assert.equal(parseAppTime("2026-10-20", "Start"), "2026-10-20T15:00:00.000Z");
  });
});

describe("reporting and csv", () => {
  it("summarizes completed work, travel, collections, and open invoices", () => {
    const report = buildReport({
      jobs: [
        { status: "done", totalCents: 18_000, travelFeeCents: 0 },
        { status: "scheduled", totalCents: 25_000, travelFeeCents: 10_000 },
      ],
      payments: [
        { status: "succeeded", amountCents: 18_000 },
        { status: "blocked", amountCents: 25_000 },
      ],
      invoices: [{ status: "issued", totalCents: 25_000 }],
    });
    assert.equal(report.jobsByStatus.done, 1);
    assert.equal(report.collectedCents, 18_000);
    assert.equal(report.outstandingCents, 25_000);
    assert.equal(report.travelFeesCents, 10_000);
    assert.equal(report.averageCompletedTicketCents, 18_000);
  });

  it("parses a quoted Housecall-style header row", () => {
    const [row] = csvRecords('First Name,Last Name,Mobile Number\n"Ada","Lovelace","(303) 555-0111"\n');
    assert.equal(row?.first_name, "Ada");
    assert.equal(row?.mobile_number, "(303) 555-0111");
  });
});
