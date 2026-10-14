# Super Cleaning Bros

Field-service app for Super Cleaning Bros in Erie, CO 80516. It covers the daily Housecall Pro workflow Majdi uses: customers and job addresses, estimates, a schedule with crew assignment, technician notes, job status, before/after photos, invoices, and a pluggable card charge. GoHighLevel stays the CRM.

This directory is a separate product inside the `majsayy/rea` fork. REA is a reverse-engineering toolkit. A cleaning-business system does not belong in REA's analysis pipeline, providers, or MCP tools, so nothing here is wired into `rea`. Run it on its own.

## Run it locally

Node.js 22.13 or newer.

```bash
cd super-cleaning-bros
npm ci
cp .env.example .env
npm start
```

Open http://localhost:8787. Times you type are read as America/Denver. Shop computers should use that time zone too.

```bash
npm test
npm run typecheck
```

With no GoHighLevel token and no Stripe key, customer and job data stay in `data/scb.sqlite`. Payments are recorded locally and are labeled as manual so they are not mistaken for a captured card. Tests use an in-memory database and fake GoHighLevel and payment clients.

Set `OFFICE_PASSWORD` and a `SESSION_SECRET` of at least 16 characters before anyone else can reach the server. Leave both blank only on your own machine.

## What the office can do

- Customers and service addresses. A repeat customer matches on last name plus phone, or last name plus address. The same first name is never enough.
- Estimates. A drive longer than 30 minutes from 80516 adds a $100 travel fee. The same ZIP is treated as in town. Known Front Range ZIP codes use an offline distance estimate. An unknown ZIP is not given a guessed fee; the office has to add a map pin or ZIP before accepting it. Set `GOOGLE_MAPS_API_KEY` to prefer Google Distance Matrix, with the offline estimate as fallback.
- An accepted price stays that price. A later rate-card change does not replace it, and the travel fee is not added on top of a price the customer already accepted. The lock follows that customer at that address.
- Schedule jobs, assign crew, and move them through scheduled, in progress, and done.
- Crew notes, before/after photos, and a post-job walkthrough flag. The crew phone view is the same site with large controls.
- Invoices. The card on file is not charged until the job is done and either the walkthrough is marked complete or both a before photo and an after photo are attached. Charging is a button, not automatic.
- A weekly schedule and a simple report: jobs, completed value, travel fees, money collected, and open invoices.

Card numbers are never stored. Save a Stripe customer id (`cus_...`) and payment method id (`pm_...`), or turn on Stripe Checkout with `STRIPE_SECRET_KEY`.

## GoHighLevel

Create a private integration token in the location Majdi uses. Put it in `.env`:

- `GHL_PRIVATE_TOKEN`
- `GHL_LOCATION_ID`
- `GHL_WEBHOOK_SECRET` (any long random string)
- Pipeline stage ids: `GHL_STAGE_SCHEDULED`, `GHL_STAGE_IN_PROGRESS`, `GHL_STAGE_DONE`, `GHL_STAGE_INVOICED`, `GHL_STAGE_PAID`

Scopes: contacts read/write, opportunities read/write. Calendar read is useful if workflows only send an appointment id.

Point a GoHighLevel workflow at:

`POST https://YOUR_HOST/api/webhooks/ghl`

Send header `X-SCB-Webhook-Secret: <GHL_WEBHOOK_SECRET>`.

Handled events include `ContactCreate`, `ContactUpdate`, `AppointmentCreate`, and `OpportunityCreate`. A booked appointment or opportunity creates the customer and the job. The opportunity `monetaryValue` is treated as the accepted dollar price. Replays of the same appointment do not create a second job.

The app pushes back:

- contact create/update
- job status as a contact note, a tag (`scb-job-scheduled`, `scb-job-in-progress`, `scb-job-done`), and the matching opportunity stage when the stage id is set
- invoice issued (`scb-invoiced`)
- payment recorded (`scb-paid`)

Recent sync attempts are listed under Import.

## Deploy

Any host that can run Node 22 and keep a disk for the SQLite file works. Put HTTPS in front of it, set `PUBLIC_BASE_URL` to that HTTPS origin, and set the office password.

```bash
npm ci
npm start
```

`Dockerfile` in this directory builds the same process. Mount a volume at `/app/data` and pass the environment from a secret store, not from the image.

Back up `data/scb.sqlite` on a schedule. That file is the system of record for jobs, invoices, and photos.

Stripe webhooks, if you use Checkout to save cards:

`POST https://YOUR_HOST/api/webhooks/stripe`

Set `STRIPE_WEBHOOK_SECRET`. The handler accepts `checkout.session.completed` for setup mode and stores the payment method id.

## Still different from Housecall Pro

This is the daily operating loop, not a full Housecall Pro replacement.

Not built yet: online booking widget, automated SMS and email reminders, consumer financing, QuickBooks, live GPS and route optimization, call tracking, marketing campaigns, payroll, a native iOS/Android app, e-sign proposals, recurring service agreements, equipment inventory, and review requests. GoHighLevel can keep doing messaging and pipeline marketing. Customer logins, password reset, and rate limiting are not in this version; the office password and crew PINs are the access control.

Historical card numbers cannot be imported. See [docs/migrating-from-housecall-pro.md](docs/migrating-from-housecall-pro.md).
