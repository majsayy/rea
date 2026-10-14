# Super Cleaning Bros

Field-service app for Super Cleaning Bros in Erie, CO 80516. It is the office and technician interface: customers and job addresses, estimates, dispatch, crew status from On my way through Finish, notes, before/after photos, invoices, and a pluggable card charge. GoHighLevel stays the CRM and sends every customer text, email, and review request.

This directory is a separate product inside the `majsayy/rea` fork. REA is a reverse-engineering toolkit. A cleaning-business system does not belong in REA's analysis pipeline, providers, or MCP tools, so nothing here is wired into `rea`. Run it on its own.

The office layout follows a familiar field-service shape: a left sidebar, a top search bar, a home dashboard, dispatch and calendar schedule views, and tabbed customer, estimate, job, and invoice pages. On a phone, crew use a bottom tab bar and open a job card into a start/finish toolbar. The name, icons, and colors are Super Cleaning Bros. Housecall Pro's logo, screenshots, and brand colors are not used.

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
- An accepted price stays that price. A later rate-card change does not replace it, and the travel fee is not added on top of a price the customer already accepted. The lock follows that customer at that address. Editing a locked price, or any price after the job leaves Scheduled, files a change order. The total stays put until the office approves it. Checking "Customer approved this change" applies it immediately and writes that approval to the job history. An unlocked job that is still scheduled can be edited directly, and that edit is logged too.
- Schedule jobs, assign crew, and move them through scheduled, in progress, and done.
- Crew notes, before/after photos, and a post-job walkthrough flag. The crew phone view is the same site with large controls.
- Invoices. The card on file is not charged until the job is done and either the walkthrough is marked complete or both a before photo and an after photo are attached. Charging is a button, not automatic.
- A weekly schedule and a simple report: jobs, completed value, travel fees, money collected, and open invoices.

Card numbers are never stored. Save a Stripe customer id (`cus_...`) and payment method id (`pm_...`), or turn on Stripe Checkout with `STRIPE_SECRET_KEY`.

## GoHighLevel

The app is the technician and office interface. Customer texts, emails, review requests, and replies are sent by GoHighLevel. The app calls the Conversations API and does not talk to a phone or an email provider itself.

Create a private integration token in the location Majdi uses. Put it in `.env`:

- `GHL_PRIVATE_TOKEN`
- `GHL_LOCATION_ID`
- `GHL_WEBHOOK_SECRET` (any long random string)
- `GHL_EMAIL_FROM` (an email address authorized on the location)
- `REVIEW_URL` (public review link; the finish text includes it only when this is set)
- Pipeline stage ids: `GHL_STAGE_SCHEDULED`, `GHL_STAGE_IN_PROGRESS`, `GHL_STAGE_DONE`, `GHL_STAGE_INVOICED`, `GHL_STAGE_PAID`
- `GHL_STAGE_ON_MY_WAY` is optional. Leave it blank and On my way does not move the opportunity.
- `GHL_PHOTO_LINK_FIELD_ID` is optional. After the photo email, the share link is written to that contact custom field.

Scopes: contacts read/write, opportunities read/write, conversations read/write, and `conversations/message.write`. Calendar read is useful if workflows only send an appointment id.

Point a GoHighLevel workflow at:

`POST https://YOUR_HOST/api/webhooks/ghl`

Send header `X-SCB-Webhook-Secret: <GHL_WEBHOOK_SECRET>`.

Handled events include `ContactCreate`, `ContactUpdate`, `AppointmentCreate`, `OpportunityCreate`, and `InboundMessage`. A booked appointment or opportunity creates the customer and the job. The opportunity `monetaryValue` is treated as the accepted dollar price. Replays of the same appointment do not create a second job. An inbound message is filed on the contact's current job: on the way or in progress, otherwise the next scheduled visit, otherwise the most recent job. GoHighLevel keeps one conversation per contact. The job page shows that whole thread and labels which job each message was filed on.

The app pushes back:

- contact create/update
- job status as a contact note, a tag (`scb-job-scheduled`, `scb-job-on-my-way`, `scb-job-in-progress`, `scb-job-done`), and the matching opportunity stage when the stage id is set
- customer SMS for On my way (technician name and an ETA when drive time is known), Start, and Finish
- a review SMS after Finish when `REVIEW_URL` is set
- an email, not a text, when both a before photo and an after photo exist. The email links to `{PUBLIC_BASE_URL}/share/{token}`. The token is unguessable. The page is a before/after gallery and does not show the phone number or the price. The link is also a contact note, and the custom field when configured.
- a schedule-change SMS only when the office confirms the prompt
- invoice issued (`scb-invoiced`)
- payment recorded (`scb-paid`)

Each of those customer messages is sent once per job. A repeated tap does not send it again. A failed send can be retried. The job status stays even when GoHighLevel rejects the send. Templates can be edited under Import. If the customer has no mobile number and `GHL_EMAIL_FROM` plus an email are set, status messages use email instead. The photo link is email only.

To run the live path against one test contact, follow [docs/ghl-lifecycle.md](docs/ghl-lifecycle.md). `npm run ghl:lifecycle` refuses to start until `GHL_E2E_CONFIRM=majdi-test-contact`.

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

Not built yet: online booking widget, reminder campaigns that are not tied to On my way / Start / Finish, consumer financing, QuickBooks, live GPS and route optimization, call tracking, marketing campaigns, payroll, a native iOS/Android app, e-sign proposals, recurring service agreements, equipment inventory, and a price book. Customer logins, password reset, and rate limiting are not in this version; the office password and crew PINs are the access control.

Dispatch has On my way, arrival windows, an unscheduled list, and drag to reschedule or reassign. There is still no live map or street-level photo. Directions open in Google Maps. The card is still charged only from the office, after the job is done and the walkthrough or both photos are in.

Historical card numbers cannot be imported. See [docs/migrating-from-housecall-pro.md](docs/migrating-from-housecall-pro.md).
