# Live GoHighLevel lifecycle

This checks one test contact from booking through the photo email and the review text. The app never texts or emails the customer itself. Every customer-facing message is a GoHighLevel Conversations API call.

Run it only for Majdi's own GoHighLevel contact. Do not put a customer's contact id, phone, or email in the test variables.

The script uses `data/ghl-e2e.sqlite`. It does not open the shop database.

## Before you run it

In `.env`:

| Variable | What to put |
| --- | --- |
| `GHL_PRIVATE_TOKEN` | Private integration token |
| `GHL_LOCATION_ID` | Location id |
| `GHL_WEBHOOK_SECRET` | The same secret the app expects on `X-SCB-Webhook-Secret` |
| `GHL_EMAIL_FROM` | An email address already authorized on that location |
| `REVIEW_URL` | The review link the finish text should include |
| `PUBLIC_BASE_URL` | The public https origin. A localhost value puts a link in the email that a phone cannot open |
| `GHL_PHOTO_LINK_FIELD_ID` | Optional text custom field id on the contact |
| `GHL_TEST_CONTACT_ID` | Majdi's contact id |
| `GHL_TEST_CONTACT_FIRST` | Majdi |
| `GHL_TEST_CONTACT_LAST` | The last name on that contact |
| `GHL_TEST_CONTACT_PHONE` | The mobile on that contact |
| `GHL_TEST_CONTACT_EMAIL` | The email on that contact |
| `GHL_E2E_CONFIRM` | Exactly `majdi-test-contact` |

Token scopes: contacts read/write, opportunities read/write, conversations read/write, and `conversations/message.write`.

The script refuses to start until `GHL_E2E_CONFIRM` is `majdi-test-contact` and every required value above is set.

## Run

From `super-cleaning-bros/`:

```bash
npm run ghl:lifecycle
```

It listens on port 8799, posts a booking webhook for the test contact, then drives On my way, Start, both photos, and Finish. Each run adds a new job on that contact. It does not message anyone else.

## What the test contact should receive

1. **Booking.** No text and no email. In GoHighLevel, the contact gets a note that the job is scheduled and the tag `scb-job-scheduled`. The job shows up in the app.
2. **On my way.** One SMS: `Hi {first}, {tech} from Super Cleaning Bros is on the way to 10 Test St, Erie. ETA in about {minutes} minutes.` If drive time is unknown, the ETA reads `shortly`. The same words are added as a contact note. The status tag becomes `scb-job-on-my-way`. The opportunity stage moves only when `GHL_STAGE_ON_MY_WAY` is set.
3. **Start.** One SMS: `Hi {first}, we started your job at 10 Test St, Erie.` Note and tag `scb-job-in-progress`.
4. **Photos.** No SMS. After both a before photo and an after photo exist, one email from `GHL_EMAIL_FROM` with subject `Your Super Cleaning Bros photos` and a link `{PUBLIC_BASE_URL}/share/{token}`. The page is an unguessable before/after gallery. It does not show the phone number or the price. The link is also a contact note. When `GHL_PHOTO_LINK_FIELD_ID` is set, that custom field is set to the same link. A second photo upload does not send a second email.
5. **Finish.** One SMS that the job is finished, then one SMS with `REVIEW_URL`. Tag `scb-job-done`.

Tapping the same step again does not send the text again. A failed GoHighLevel send stays on the job as failed and can be retried. The job status is kept either way.

A reply from the contact comes back through a GoHighLevel inbound-message workflow to `POST /api/webhooks/ghl`. It is filed on the job that is on the way or in progress.
