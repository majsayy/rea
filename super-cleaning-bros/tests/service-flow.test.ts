import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { saveCustomer } from "../src/app/customers.ts";
import { acceptEstimate, createEstimate } from "../src/app/estimates.ts";
import { addPhoto, createJob, updateJob, updateJobPrice } from "../src/app/jobs.ts";
import { chargeInvoice, createInvoice, saveCard } from "../src/app/billing.ts";
import { createTechnician } from "../src/app/crew.ts";
import { importCustomers } from "../src/app/importer.ts";
import { AppError } from "../src/domain/errors.ts";
import { address, app, office } from "./helpers.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("office job flow", () => {
  it("keeps an accepted price, then charges only after the job is done and photos are in", async () => {
    const { ctx, close, ghl, payments } = app();
    try {
      const crew = createTechnician(ctx, office, { name: "Crew A", pin: "1234" });
      const saved = await saveCustomer(
        ctx,
        office,
        {
          firstName: "Sam",
          lastName: "Garcia",
          phone: "(303) 555-0100",
          email: "sam@example.com",
          ghlContactId: null,
          address: address("10 Main St", "80516"),
        },
        { sync: true },
      );
      assert.equal(saved.matchedExisting, false);
      assert.equal(saved.sync?.state, "sent");
      const again = await saveCustomer(
        ctx,
        office,
        {
          firstName: "Samantha",
          lastName: "Garcia",
          phone: "3035550100",
          email: null,
          ghlContactId: null,
          address: address("10 Main Street", "80516"),
        },
        { sync: false },
      );
      assert.equal(again.matchedExisting, true);
      assert.ok(again.matchedOn.includes("phone"));
      assert.equal(again.customer.id, saved.customer.id);

      const addressId = saved.address?.id ?? "";
      const first = await createEstimate(ctx, office, {
        customerId: saved.customer.id,
        addressId,
        description: "Standard clean",
        serviceCents: 18_000,
      });
      assert.equal(first.travelFeeCents, 0);
      assert.equal(first.totalCents, 18_000);
      acceptEstimate(ctx, office, first.id);

      const raised = await createEstimate(ctx, office, {
        customerId: saved.customer.id,
        addressId,
        description: "Standard clean",
        serviceCents: 25_000,
      });
      assert.equal(raised.priceLocked, true);
      assert.equal(raised.totalCents, 18_000);

      const denver = await saveCustomer(
        ctx,
        office,
        {
          firstName: "Riley",
          lastName: "Nguyen",
          phone: "7205550199",
          email: null,
          ghlContactId: null,
          address: address("500 Market St", "80202", "Denver"),
        },
        { sync: false },
      );
      const denverEstimate = await createEstimate(ctx, office, {
        customerId: denver.customer.id,
        addressId: denver.address?.id,
        description: "Deep clean",
        serviceCents: 15_000,
      });
      assert.equal(denverEstimate.travelFeeCents, 10_000);
      assert.equal(denverEstimate.totalCents, 25_000);

      const unknown = await saveCustomer(
        ctx,
        office,
        {
          firstName: "Jo",
          lastName: "Park",
          phone: "9705550188",
          email: null,
          ghlContactId: null,
          address: address("1 Far Away", "99999", "Other"),
        },
        { sync: false },
      );
      const review = await createEstimate(ctx, office, {
        customerId: unknown.customer.id,
        addressId: unknown.address?.id,
        serviceCents: 12_000,
        description: "Clean",
      });
      assert.equal(review.travelReviewRequired, true);
      assert.throws(() => acceptEstimate(ctx, office, review.id), (error: unknown) => {
        return error instanceof AppError && error.code === "travel_review_required";
      });

      const job = await createJob(ctx, office, {
        customerId: saved.customer.id,
        addressId,
        title: "Standard clean",
        scheduledStart: "2026-10-20T09:00",
        scheduledEnd: "2026-10-20T11:00",
        serviceCents: 25_000,
        technicianIds: [crew.id],
      });
      assert.equal(job.job.priceLocked, true);
      assert.equal(job.job.totalCents, 18_000);
      assert.equal(job.job.scheduledStart, "2026-10-20T15:00:00.000Z");
      assert.throws(() => updateJobPrice(ctx, office, job.job.id, { serviceCents: 30_000 }), (error: unknown) => {
        return error instanceof AppError && error.code === "price_locked";
      });

      await updateJob(ctx, office, job.job.id, { status: "in_progress" });
      await updateJob(ctx, office, job.job.id, { status: "done" });
      saveCard(ctx, office, saved.customer.id, {
        provider: "manual",
        providerCustomerId: "local_customer",
        providerPaymentMethodId: "local_card",
        brand: "visa",
        last4: "4242",
      });
      const invoice = await createInvoice(ctx, office, job.job.id);
      await assert.rejects(chargeInvoice(ctx, office, invoice.invoice.id), (error: unknown) => {
        return error instanceof AppError && error.code === "completion_evidence_missing";
      });
      assert.equal(payments.charges.length, 0);

      addPhoto(ctx, office, job.job.id, { kind: "before", contentType: "image/png", dataBase64: png });
      addPhoto(ctx, office, job.job.id, { kind: "after", contentType: "image/png", dataBase64: png });
      const paid = await chargeInvoice(ctx, office, invoice.invoice.id);
      assert.equal(paid.payment.status, "succeeded");
      assert.equal(payments.charges.length, 1);
      assert.equal(paid.payment.amountCents, 18_000);
      assert.ok(ghl.notes.some((note) => note.body.includes("done")));
      assert.ok(ghl.tags.some((tag) => tag.tags.includes("scb-paid")));
      assert.ok(ghl.stages.length >= 0);
    } finally {
      close();
    }
  });

  it("imports a Housecall-shaped row without stacking a new travel fee on the old price", async () => {
    const { ctx, close } = app({ ghl: null });
    try {
      const result = await importCustomers(
        ctx,
        office,
        [
          "First Name,Last Name,Mobile Number,Address,City,State,Zip,Job Title,Job Date,Total,Status",
          "Ada,Lovelace,(303) 555-0111,500 Market St,Denver,CO,80202,Deep clean,2026-10-22,$250.00,Completed",
        ].join("\n"),
      );
      assert.equal(result.created, 1);
      assert.equal(result.jobs, 1);
      assert.deepEqual(result.errors, []);
      const jobs = ctx.store.listJobs("2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
      assert.equal(jobs[0]?.totalCents, 25_000);
      assert.equal(jobs[0]?.priceLocked, true);
      assert.equal(jobs[0]?.status, "done");
      assert.equal(jobs[0]?.travelFeeCents, 10_000);
      assert.equal(jobs[0]?.serviceCents, 15_000);
    } finally {
      close();
    }
  });
});
