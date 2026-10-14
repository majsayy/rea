import type { ChargeInput, ChargeResult, PaymentProvider } from "./provider.ts";

export class ManualPaymentProvider implements PaymentProvider {
  readonly name = "manual";

  charge(input: ChargeInput): Promise<ChargeResult> {
    return Promise.resolve({
      providerRef: `manual_${input.idempotencyKey}`,
      status: "succeeded",
    });
  }
}
