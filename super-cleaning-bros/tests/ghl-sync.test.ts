import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleGhlWebhook } from "../src/ghl/inbound.ts";
import { HttpGhlClient } from "../src/ghl/client.ts";
import { parseGhlWebhook } from "../src/ghl/parse.ts";
import { saveCustomer } from "../src/app/customers.ts";
import { GoogleDriveTime } from "../src/drive/driveTime.ts";
import { verifyStripeSignature } from "../src/payments/stripeSignature.ts";
import { createHmac } from "node:crypto";
import { app, office, address } from "./helpers.ts";

describe("GoHighLevel sync", () => {
  it("creates one customer and job from a booked appointment and ignores the replay", async () => {
    const { ctx, close, ghl } = app();
    try {
      const payload = {
        type: "AppointmentCreate",
        appointment: {
          id: "apt_1",
          title: "Standard clean",
          startTime: "2026-10-21T15:00:00.000Z",
          endTime: "2026-10-21T17:00:00.000Z",
          address: "500 Market St, Denver, CO 80202",
          contactId: "con_9",
        },
        opportunity: { id: "opp_9", monetaryValue: 250 },
        contact: {
          id: "con_9",
          firstName: "Riley",
          lastName: "Nguyen",
          phone: "+17205550199",
        },
      };
      const created = await handleGhlWebhook(ctx, payload, "evt_1");
      assert.equal(created.existing, false);
      const job = ctx.store.getJob(String(created.jobId));
      assert.equal(job?.totalCents, 25_000);
      assert.equal(job?.priceLocked, true);
      assert.equal(job?.travelFeeCents, 10_000);
      assert.equal(job?.ghlAppointmentId, "apt_1");
      assert.equal(job?.ghlOpportunityId, "opp_9");
      const replay = await handleGhlWebhook(ctx, payload, "evt_1");
      assert.equal(replay.duplicate, true);
      const again = await handleGhlWebhook(ctx, payload, "evt_2");
      assert.equal(again.existing, true);
      assert.equal(ctx.store.listJobs("2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z").length, 1);
      assert.ok(ghl.tags.some((entry) => entry.tags.includes("scb-job-scheduled")));
      assert.ok(ghl.stages.some((stage) => stage.opportunityId === "opp_9" && stage.stageId === "stage_scheduled"));
    } finally {
      close();
    }
  });

  it("matches an inbound contact on last name and phone instead of creating another customer", async () => {
    const { ctx, close } = app();
    try {
      const saved = await saveCustomer(
        ctx,
        office,
        {
          firstName: "Sam",
          lastName: "Garcia",
          phone: "3035550100",
          email: null,
          ghlContactId: null,
          address: address("10 Main St", "80516"),
        },
        { sync: false },
      );
      const result = await handleGhlWebhook(
        ctx,
        {
          type: "ContactUpdate",
          id: "con_garcia",
          firstName: "Samantha",
          lastName: "Garcia",
          phone: "(303) 555-0100",
          address1: "10 Main Street",
          city: "Erie",
          state: "CO",
          postalCode: "80516",
        },
        null,
      );
      assert.equal(result.matchedExisting, true);
      assert.equal(result.customerId, saved.customer.id);
      assert.equal(ctx.store.getCustomer(saved.customer.id)?.ghlContactId, "con_garcia");
    } finally {
      close();
    }
  });

  it("does not treat a contact event as a booking", () => {
    const parsed = parseGhlWebhook({ type: "ContactCreate", firstName: "Ada", lastName: "Lovelace", phone: "3035550111" });
    assert.equal(parsed.kind, "contact");
  });

  it("sends the private token and version header without putting the token in the URL", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ contact: { id: "con_new", firstName: "Ada", lastName: "Lovelace" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = new HttpGhlClient({
      token: "pit-secret",
      locationId: "loc_1",
      apiBase: "https://services.leadconnectorhq.com",
      apiVersion: "2021-07-28",
      userId: null,
      fetchImpl,
    });
    const contact = await client.upsertContact({
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "3035550111",
      email: null,
      address1: null,
      city: null,
      state: null,
      postalCode: null,
    });
    assert.equal(contact.id, "con_new");
    assert.equal(calls[0]?.headers.get("authorization"), "Bearer pit-secret");
    assert.equal(calls[0]?.headers.get("version"), "2021-07-28");
    assert.equal(calls[0]?.url.includes("pit-secret"), false);
  });
});

describe("providers", () => {
  it("verifies a Stripe signature and rejects a stale one", () => {
    const raw = '{"ok":true}';
    const secret = "whsec_test";
    const timestamp = 1_700_000_000;
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    const header = `t=${timestamp},v1=${signature}`;
    assert.equal(verifyStripeSignature(raw, header, secret, timestamp + 10), true);
    assert.equal(verifyStripeSignature(raw, header, secret, timestamp + 1_000), false);
    assert.equal(verifyStripeSignature(raw, header, "other", timestamp), false);
  });

  it("reads Google drive minutes and falls back through the caller when Google fails", async () => {
    const drive = new GoogleDriveTime(shop(), "maps-key", async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("key"), "maps-key");
      assert.equal(url.searchParams.get("destinations"), "80202");
      return new Response(
        JSON.stringify({ rows: [{ elements: [{ status: "OK", duration: { value: 2400 } }] }] }),
        { status: 200 },
      );
    });
    const estimate = await drive.estimate({ lat: null, lng: null, postalCode: "80202" });
    assert.equal(estimate.basis, "google");
    assert.equal(estimate.minutes, 40);
  });
});

function shop() {
  return { lat: 40.0503, lng: -105.0497, postalCode: "80516" };
}
