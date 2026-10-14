import { isRecord } from "../domain/errors.ts";
import type { ChargeInput, ChargeResult, PaymentProvider } from "./provider.ts";

export class StripeGateway implements PaymentProvider {
  readonly name = "stripe";

  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const body = new URLSearchParams({
      amount: String(input.amountCents),
      currency: input.currency,
      customer: input.customerRef,
      payment_method: input.paymentMethodRef,
      confirm: "true",
      off_session: "true",
      description: input.description,
      "metadata[scb_idempotency_key]": input.idempotencyKey,
    });
    const payload = await this.form("/v1/payment_intents", body, input.idempotencyKey);
    const status = typeof payload.status === "string" ? payload.status : "";
    const id = typeof payload.id === "string" ? payload.id : input.idempotencyKey;
    if (status === "succeeded") return { providerRef: id, status: "succeeded" };
    return { providerRef: id, status: "failed" };
  }

  async createCustomer(input: {
    name: string;
    email: string | null;
    phone: string;
    customerId: string;
  }): Promise<string> {
    const body = new URLSearchParams({
      name: input.name,
      phone: input.phone,
      "metadata[scb_customer_id]": input.customerId,
    });
    if (input.email) body.set("email", input.email);
    const payload = await this.form("/v1/customers", body);
    if (typeof payload.id !== "string") throw new Error("Stripe did not return a customer id");
    return payload.id;
  }

  async createSetupCheckout(input: {
    customerId: string;
    stripeCustomerId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string> {
    const body = new URLSearchParams({
      mode: "setup",
      customer: input.stripeCustomerId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "payment_method_types[0]": "card",
      "metadata[scb_customer_id]": input.customerId,
    });
    const payload = await this.form("/v1/checkout/sessions", body);
    if (typeof payload.url !== "string") throw new Error("Stripe did not return a Checkout URL");
    return payload.url;
  }

  async paymentMethodFromSetupIntent(setupIntentId: string): Promise<{
    paymentMethodId: string;
    brand: string | null;
    last4: string | null;
  }> {
    const intent = await this.get(`/v1/setup_intents/${encodeURIComponent(setupIntentId)}`);
    const paymentMethodId =
      typeof intent.payment_method === "string" ? intent.payment_method : null;
    if (!paymentMethodId) throw new Error("SetupIntent has no payment method");
    const method = await this.get(`/v1/payment_methods/${encodeURIComponent(paymentMethodId)}`);
    const card = isRecord(method.card) ? method.card : null;
    return {
      paymentMethodId,
      brand: card && typeof card.brand === "string" ? card.brand : null,
      last4: card && typeof card.last4 === "string" ? card.last4 : null,
    };
  }

  private async form(
    path: string,
    body: URLSearchParams,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await this.fetchImpl(`https://api.stripe.com${path}`, {
      method: "POST",
      headers,
      body,
    });
    return readStripe(response);
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`https://api.stripe.com${path}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
    return readStripe(response);
  }
}

async function readStripe(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error("Stripe returned an unreadable response");
  if (!response.ok) {
    const error = isRecord(payload.error) ? payload.error : null;
    const message = error && typeof error.message === "string" ? error.message : response.statusText;
    throw new Error(message);
  }
  return payload;
}
