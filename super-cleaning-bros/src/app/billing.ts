import type { Payment, SyncState } from "../domain/types.ts";
import { chargeDecision } from "../domain/chargeGate.ts";
import { AppError, isRecord } from "../domain/errors.ts";
import { verifyStripeSignature } from "../payments/stripeSignature.ts";
import type { Actor } from "./actors.ts";
import { assertOffice } from "./actors.ts";
import type { Ctx } from "./context.ts";
import { pushInvoiceEvent, pushPaymentEvent, requireCustomer } from "../ghl/outbound.ts";
import { cleanText } from "./validate.ts";

export async function createInvoice(ctx: Ctx, actor: Actor, jobId: string) {
  assertOffice(actor);
  const job = ctx.store.getJob(jobId);
  if (!job) throw new AppError("not_found", "Job not found.", 404);
  const existing = ctx.store.latestInvoiceForJob(jobId);
  if (existing) return { invoice: existing, sync: { state: "skipped", reason: "already_issued" } as SyncState };
  const lines = invoiceLines(job.title, job.serviceCents, job.travelFeeCents, job.lineItems);
  const invoice = ctx.store.insertInvoice({
    jobId: job.id,
    customerId: job.customerId,
    totalCents: job.totalCents,
    serviceCents: job.serviceCents,
    travelFeeCents: job.travelFeeCents,
    status: "issued",
    lineItems: lines,
    issuedAt: ctx.store.now().toISOString(),
  });
  const customer = requireCustomer(ctx, job.customerId);
  const sync = await pushInvoiceEvent(
    ctx,
    { number: invoice.number, totalCents: invoice.totalCents, opportunityId: job.ghlOpportunityId },
    customer,
  );
  return { invoice, sync };
}

export async function chargeInvoice(ctx: Ctx, actor: Actor, invoiceId: string) {
  assertOffice(actor);
  const invoice = ctx.store.getInvoice(invoiceId);
  if (!invoice) throw new AppError("not_found", "Invoice not found.", 404);
  if (invoice.status === "void") throw new AppError("invoice_void", "This invoice is void.", 409);
  const already = ctx.store.succeededPayment(invoice.id);
  if (already) return { payment: already, sync: { state: "skipped", reason: "already_paid" } as SyncState };
  const job = ctx.store.getJob(invoice.jobId);
  if (!job) throw new AppError("not_found", "Job not found.", 404);
  const card = ctx.store.getCard(invoice.customerId);
  const decision = chargeDecision({
    status: job.status,
    postWalkthroughComplete: job.postWalkthroughComplete,
    beforePhotos: ctx.store.countPhotosByKind(job.id, "before"),
    afterPhotos: ctx.store.countPhotosByKind(job.id, "after"),
    hasCard: card !== null,
  });
  if (!decision.ok) {
    ctx.store.insertPayment({
      invoiceId: invoice.id,
      jobId: job.id,
      amountCents: invoice.totalCents,
      status: "blocked",
      provider: ctx.payments.name,
      providerRef: null,
      blockedReason: decision.reason,
    });
    throw new AppError(decision.reason, decision.message, 409);
  }
  if (!card) throw new AppError("no_card_on_file", "Save a card on file before charging.", 409);
  if (ctx.payments.name === "stripe" && card.provider !== "stripe") {
    throw new AppError("card_provider", "Save a Stripe card before charging through Stripe.", 409);
  }
  let payment: Payment;
  try {
    const result = await ctx.payments.charge({
      amountCents: invoice.totalCents,
      currency: "usd",
      customerRef: card.providerCustomerId,
      paymentMethodRef: card.providerPaymentMethodId,
      idempotencyKey: `scb-invoice-${invoice.id}`,
      description: `Super Cleaning Bros ${invoice.number}`,
    });
    if (result.status !== "succeeded") {
      ctx.store.insertPayment({
        invoiceId: invoice.id,
        jobId: job.id,
        amountCents: invoice.totalCents,
        status: "failed",
        provider: ctx.payments.name,
        providerRef: result.providerRef,
        blockedReason: null,
      });
      throw new AppError("payment_failed", "The payment provider did not capture the card.", 402);
    }
    payment = ctx.store.transaction(() => {
      const recorded = ctx.store.insertPayment({
        invoiceId: invoice.id,
        jobId: job.id,
        amountCents: invoice.totalCents,
        status: "succeeded",
        provider: ctx.payments.name,
        providerRef: result.providerRef,
        blockedReason: null,
      });
      ctx.store.markInvoicePaid(invoice.id);
      return recorded;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const detail = error instanceof Error ? error.message : "Payment failed";
    ctx.store.insertPayment({
      invoiceId: invoice.id,
      jobId: job.id,
      amountCents: invoice.totalCents,
      status: "failed",
      provider: ctx.payments.name,
      providerRef: null,
      blockedReason: null,
    });
    throw new AppError("payment_failed", detail, 402);
  }
  const customer = requireCustomer(ctx, invoice.customerId);
  const sync = await pushPaymentEvent(
    ctx,
    { amountCents: payment.amountCents, provider: payment.provider, opportunityId: job.ghlOpportunityId },
    customer,
  );
  return { payment, invoice: ctx.store.getInvoice(invoice.id), sync };
}

export function saveCard(ctx: Ctx, actor: Actor, customerId: string, body: unknown) {
  assertOffice(actor);
  requireCustomer(ctx, customerId);
  if (!isRecord(body)) throw new AppError("invalid_field", "Card reference is required.", 400);
  const provider = cleanText(body.provider ?? ctx.payments.name, "Provider", 40);
  const providerCustomerId = cleanText(body.providerCustomerId, "Provider customer id", 120);
  const providerPaymentMethodId = cleanText(body.providerPaymentMethodId, "Payment method id", 120);
  const last4 = body.last4 === undefined || body.last4 === null || body.last4 === "" ? null : cleanText(body.last4, "Last 4", 4);
  if (last4 && !/^\d{4}$/.test(last4)) throw new AppError("invalid_field", "Last 4 must be four digits.", 400);
  return ctx.store.upsertCard({
    customerId,
    provider,
    providerCustomerId,
    providerPaymentMethodId,
    brand: body.brand === undefined || body.brand === null || body.brand === "" ? null : cleanText(body.brand, "Brand", 20),
    last4,
  });
}

export async function createCardSetup(ctx: Ctx, actor: Actor, customerId: string) {
  assertOffice(actor);
  if (!ctx.stripe) {
    throw new AppError("payments_not_configured", "Set STRIPE_SECRET_KEY to save a card with Stripe Checkout.", 503);
  }
  const customer = requireCustomer(ctx, customerId);
  let stripeCustomerId = customer.stripeCustomerId;
  if (!stripeCustomerId) {
    stripeCustomerId = await ctx.stripe.createCustomer({
      name: `${customer.firstName} ${customer.lastName}`.trim(),
      email: customer.email,
      phone: customer.phone,
      customerId: customer.id,
    });
    ctx.store.updateCustomer(customer.id, {
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
      email: customer.email,
      ghlContactId: customer.ghlContactId,
      stripeCustomerId,
    });
  }
  const url = await ctx.stripe.createSetupCheckout({
    customerId: customer.id,
    stripeCustomerId,
    successUrl: `${ctx.config.publicBaseUrl}/?card=saved`,
    cancelUrl: `${ctx.config.publicBaseUrl}/?card=cancelled`,
  });
  return { url };
}

export async function handleStripeWebhook(ctx: Ctx, rawBody: string, signature: string | null) {
  const secret = ctx.config.stripe.webhookSecret;
  if (!secret || !ctx.stripe) {
    throw new AppError("payments_not_configured", "Stripe webhooks are not configured.", 503);
  }
  const nowSeconds = Math.floor(ctx.store.now().getTime() / 1000);
  if (!verifyStripeSignature(rawBody, signature, secret, nowSeconds)) {
    throw new AppError("invalid_signature", "Stripe signature did not match.", 401);
  }
  const event: unknown = JSON.parse(rawBody);
  if (!isRecord(event) || event.type !== "checkout.session.completed" || !isRecord(event.data)) {
    return { ignored: true };
  }
  const session = event.data.object;
  if (!isRecord(session) || session.mode !== "setup") return { ignored: true };
  const metadata = isRecord(session.metadata) ? session.metadata : {};
  const customerId = typeof metadata.scb_customer_id === "string" ? metadata.scb_customer_id : "";
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : "";
  const setupIntentId = typeof session.setup_intent === "string" ? session.setup_intent : "";
  if (!customerId || !stripeCustomerId || !setupIntentId) {
    throw new AppError("invalid_webhook", "Checkout session was missing card details.", 422);
  }
  const method = await ctx.stripe.paymentMethodFromSetupIntent(setupIntentId);
  const customer = requireCustomer(ctx, customerId);
  ctx.store.updateCustomer(customer.id, {
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    email: customer.email,
    ghlContactId: customer.ghlContactId,
    stripeCustomerId,
  });
  const card = ctx.store.upsertCard({
    customerId,
    provider: "stripe",
    providerCustomerId: stripeCustomerId,
    providerPaymentMethodId: method.paymentMethodId,
    brand: method.brand,
    last4: method.last4,
  });
  return { customerId, card };
}

function invoiceLines(
  title: string,
  serviceCents: number,
  travelFeeCents: number,
  lineItems: { description: string; amountCents: number }[],
) {
  const sum = lineItems.reduce((total, item) => total + item.amountCents, 0);
  const service = lineItems.length > 0 && sum === serviceCents ? lineItems : [{ description: title, amountCents: serviceCents }];
  if (travelFeeCents > 0) {
    return [...service, { description: "Travel fee (more than 30 minutes from Erie)", amountCents: travelFeeCents }];
  }
  return service;
}
