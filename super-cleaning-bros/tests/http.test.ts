import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildContext } from "../src/app/context.ts";
import { loadConfig } from "../src/config.ts";
import { createHttpServer } from "../src/http/server.ts";
import { RecordingGhl, RecordingPayments } from "./helpers.ts";

describe("HTTP API", () => {
  it("requires the webhook secret and a sign-in when the office password is set", async () => {
    const ghl = new RecordingGhl();
    const payments = new RecordingPayments();
    let sequence = 0;
    const config = loadConfig({
      DATABASE_PATH: ":memory:",
      OFFICE_PASSWORD: "correct-horse",
      SESSION_SECRET: "session-secret-value",
      GHL_WEBHOOK_SECRET: "hook-secret",
      PUBLIC_BASE_URL: "http://localhost:8787",
    });
    const { ctx, close } = buildContext({
      config,
      ghl,
      payments,
      now: () => new Date("2026-10-14T15:00:00.000Z"),
      id: () => `id_${++sequence}`,
    });
    const server = createHttpServer(ctx);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;
    try {
      const health = await fetch(`${base}/api/health`);
      assert.equal((await health.json()).payments, "manual");
      const locked = await fetch(`${base}/api/customers`);
      assert.equal(locked.status, 401);
      const denied = await fetch(`${base}/api/webhooks/ghl`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "ContactCreate" }),
      });
      assert.equal(denied.status, 401);
      const booked = await fetch(`${base}/api/webhooks/ghl`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-scb-webhook-secret": "hook-secret",
        },
        body: JSON.stringify({
          type: "OpportunityCreate",
          id: "opp_http",
          name: "Move-out clean",
          monetaryValue: 180,
          contact: {
            id: "con_http",
            firstName: "Ada",
            lastName: "Lovelace",
            phone: "3035550111",
            address1: "10 Main St",
            city: "Erie",
            state: "CO",
            postalCode: "80516",
          },
        }),
      });
      assert.equal(booked.status, 200);
      const bookedBody = await booked.json();
      assert.equal(typeof bookedBody.jobId, "string");

      const badLogin = await fetch(`${base}/api/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "nope" }),
      });
      assert.equal(badLogin.status, 401);
      const login = await fetch(`${base}/api/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "correct-horse" }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
      const jobs = await fetch(`${base}/api/jobs?from=2026-10-01&to=2026-11-01`, { headers: { cookie } });
      const body = await jobs.json();
      assert.equal(jobs.status, 200);
      assert.equal(body.jobs.length, 1);
      assert.equal(body.jobs[0].totalCents, 18_000);
      assert.equal(body.jobs[0].priceLocked, true);
      assert.equal(body.jobs[0].invoice, null);

      const page = await fetch(`${base}/`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Super Cleaning Bros/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      close();
    }
  });
});
