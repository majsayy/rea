import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { saveCustomer } from "../src/app/customers.ts";
import { createTechnician } from "../src/app/crew.ts";
import { addNote, addPhoto, createJob, editNote, getJob, listJobs, listUnscheduled, updateJob, updateJobPrice, decideChangeOrder, sendJobMessage } from "../src/app/jobs.ts";
import { saveTemplates } from "../src/app/notify.ts";
import { handleGhlWebhook } from "../src/ghl/inbound.ts";
import { createHttpServer } from "../src/http/server.ts";
import { address, app, office } from "./helpers.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("GoHighLevel customer messages", () => {
  it("texts each status once, emails the photo link, and files the contact thread on the job", async () => {
    const { ctx, close, ghl } = app({
      env: {
        REVIEW_URL: "https://reviews.example/scb",
        GHL_EMAIL_FROM: "crew@super-cleaning-bros.test",
        GHL_PHOTO_LINK_FIELD_ID: "field_photos",
        PUBLIC_BASE_URL: "http://localhost:8787",
      },
    });
    try {
      const crew = createTechnician(ctx, office, { name: "Crew A", pin: "2468" });
      const saved = await saveCustomer(
        ctx,
        office,
        {
          firstName: "Majdi",
          lastName: "Sayyid",
          phone: "3035550191",
          email: "majdi@example.com",
          ghlContactId: "con_majdi",
          address: address("10 Main St", "80516"),
        },
        { sync: true },
      );
      const job = await createJob(ctx, office, {
        customerId: saved.customer.id,
        addressId: saved.address?.id,
        title: "Standard clean",
        scheduledStart: "2026-10-16T09:00",
        scheduledEnd: "2026-10-16T11:00",
        serviceCents: 18_000,
        technicianIds: [crew.id],
      });
      assert.equal(ghl.messages.length, 0);

      await updateJob(ctx, office, job.job.id, { status: "on_my_way" });
      await updateJob(ctx, office, job.job.id, { status: "scheduled" });
      await updateJob(ctx, office, job.job.id, { status: "on_my_way" });
      const omw = ghl.messages.filter((message) => message.message.includes("on the way"));
      assert.equal(omw.length, 1);
      assert.equal(omw[0]?.channel, "sms");
      assert.match(omw[0]?.message ?? "", /Crew A/);
      assert.match(omw[0]?.message ?? "", /in about \d+ minutes|shortly/);
      assert.ok(ghl.notes.some((note) => note.body.includes("on the way")));
      assert.ok(ghl.tags.some((tag) => tag.tags.includes("scb-job-on-my-way")));

      await updateJob(ctx, office, job.job.id, { status: "in_progress" });
      await updateJob(ctx, office, job.job.id, { status: "in_progress" });
      assert.equal(ghl.messages.filter((message) => message.message.includes("started your job")).length, 1);

      await addPhoto(ctx, office, job.job.id, { kind: "before", contentType: "image/png", dataBase64: png });
      assert.equal(ghl.messages.filter((message) => message.channel === "email").length, 0);
      await addPhoto(ctx, office, job.job.id, { kind: "after", contentType: "image/png", dataBase64: png });
      await addPhoto(ctx, office, job.job.id, { kind: "after", contentType: "image/png", dataBase64: png });
      const emails = ghl.messages.filter((message) => message.channel === "email");
      assert.equal(emails.length, 1);
      assert.match(emails[0]?.message ?? "", /http:\/\/localhost:8787\/share\//);
      assert.equal(ghl.fields.length, 1);
      assert.equal(ghl.fields[0]?.fieldId, "field_photos");

      await updateJob(ctx, office, job.job.id, { status: "done" });
      assert.equal(ghl.messages.filter((message) => message.message.includes("finished your job")).length, 1);
      assert.equal(ghl.messages.filter((message) => message.message.includes("https://reviews.example/scb")).length, 1);

      const sent = await sendJobMessage(ctx, office, job.job.id, { body: "Gate code is on the job notes.", idempotencyKey: "once" });
      assert.equal(sent.status, "sent");
      const again = await sendJobMessage(ctx, office, job.job.id, { body: "Gate code is on the job notes.", idempotencyKey: "once" });
      assert.equal(again.status, "sent");
      assert.equal(ghl.messages.filter((message) => message.message.includes("Gate code")).length, 1);

      const inbound = await handleGhlWebhook(
        ctx,
        {
          type: "InboundMessage",
          contactId: "con_majdi",
          messageId: "in_1",
          body: "Sounds good, see you soon.",
          direction: "inbound",
        },
        "receipt-in-1",
      );
      assert.equal(inbound.jobId, job.job.id);
      const replay = await handleGhlWebhook(
        ctx,
        {
          type: "InboundMessage",
          contactId: "con_majdi",
          messageId: "in_1",
          body: "Sounds good, see you soon.",
          direction: "inbound",
        },
        "receipt-in-1b",
      );
      assert.equal(replay.duplicate, true);
      const detail = getJob(ctx, office, job.job.id);
      assert.ok(detail.thread.some((message) => message.direction === "inbound" && message.body.includes("Sounds good")));
      assert.ok(detail.thread.some((message) => message.direction === "outbound" && message.trigger === "on_my_way"));
      assert.ok(detail.photoUrl?.includes("/share/"));

      const server = createHttpServer(ctx);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const addressInfo = server.address();
      const port = typeof addressInfo === "object" && addressInfo ? addressInfo.port : 0;
      const token = detail.photoUrl?.split("/share/")[1] ?? "";
      const page = await fetch(`http://127.0.0.1:${port}/share/${token}`);
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.match(html, /Before/);
      assert.match(html, /After/);
      assert.doesNotMatch(html, /3035550191/);
      assert.doesNotMatch(html, /\$180/);
      server.close();
    } finally {
      close();
    }
  });

  it("keeps a locked price until the office approves, and logs a customer-approved change", async () => {
    const { ctx, close } = app({ ghl: null });
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
      const locked = await createJob(ctx, office, {
        customerId: saved.customer.id,
        addressId: saved.address?.id,
        title: "Clean",
        scheduledStart: "2026-10-20T09:00",
        serviceCents: 18_000,
        lockedTotalCents: 18_000,
        technicianIds: [],
      });
      const pending = updateJobPrice(ctx, office, locked.job.id, { serviceCents: 22_000, reason: "Extra oven" });
      assert.equal(pending.job.totalCents, 18_000);
      assert.equal(pending.changeOrder.status, "pending");
      const approved = decideChangeOrder(ctx, office, locked.job.id, pending.changeOrder.id, "approved");
      assert.equal(approved.job.totalCents, 22_000);
      assert.ok(approved.audit.some((entry) => entry.action === "price.approved"));

      const open = await createJob(ctx, office, {
        customerId: saved.customer.id,
        addressId: saved.address?.id,
        title: "Touch-up",
        scheduledStart: "2026-10-21T09:00",
        serviceCents: 9_000,
        technicianIds: [],
      });
      const direct = updateJobPrice(ctx, office, open.job.id, { serviceCents: 10_000 });
      assert.equal(direct.job.totalCents, 10_000);
      const approvedNow = updateJobPrice(ctx, office, locked.job.id, {
        serviceCents: 24_000,
        customerApproved: true,
        reason: "Customer asked for baseboards",
      });
      assert.equal(approvedNow.job.totalCents, 24_000);
      assert.equal(approvedNow.changeOrder.customerApproved, true);
      const note = addNote(ctx, office, open.job.id, { body: "Use the side door." });
      editNote(ctx, office, open.job.id, note.id, { body: "Use the side door. Dog is friendly." });
      assert.ok(getJob(ctx, office, open.job.id).audit.some((entry) => entry.action === "note.edit" && entry.detail.includes("→")));
    } finally {
      close();
    }
  });

  it("lists unscheduled jobs apart from the calendar and notifies a moved visit once per time", async () => {
    const { ctx, close, ghl } = app();
    try {
      const saved = await saveCustomer(
        ctx,
        office,
        {
          firstName: "Riley",
          lastName: "Nguyen",
          phone: "7205550199",
          email: "riley@example.com",
          ghlContactId: "con_riley",
          address: address("500 Market St", "80202", "Denver"),
        },
        { sync: true },
      );
      const job = await createJob(ctx, office, {
        customerId: saved.customer.id,
        addressId: saved.address?.id,
        title: "Deep clean",
        unscheduled: true,
        serviceCents: 15_000,
        technicianIds: [],
      });
      assert.equal(job.job.unscheduled, true);
      assert.equal(listJobs(ctx, office, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z").length, 0);
      assert.equal(listUnscheduled(ctx, office).length, 1);
      await updateJob(ctx, office, job.job.id, {
        unscheduled: false,
        scheduledStart: "2026-10-22T13:00",
        scheduledEnd: "2026-10-22T15:00",
        notifyCustomer: true,
      });
      await updateJob(ctx, office, job.job.id, {
        scheduledStart: "2026-10-22T13:00",
        scheduledEnd: "2026-10-22T15:00",
        notifyCustomer: true,
      });
      assert.equal(ghl.messages.filter((message) => message.message.includes("was moved")).length, 1);
      await updateJob(ctx, office, job.job.id, {
        scheduledStart: "2026-10-23T09:00",
        scheduledEnd: "2026-10-23T11:00",
        notifyCustomer: true,
      });
      assert.equal(ghl.messages.filter((message) => message.message.includes("was moved")).length, 2);
      saveTemplates(ctx, { templates: [{ key: "on_my_way", body: "On the way, {{customerFirst}}." }] });
      await updateJob(ctx, office, job.job.id, { status: "on_my_way" });
      assert.ok(ghl.messages.some((message) => message.message === "On the way, Riley."));
    } finally {
      close();
    }
  });
});
