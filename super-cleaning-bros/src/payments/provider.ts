export type ChargeInput = {
  amountCents: number;
  currency: "usd";
  customerRef: string;
  paymentMethodRef: string;
  idempotencyKey: string;
  description: string;
};

export type ChargeResult = {
  providerRef: string;
  status: "succeeded" | "failed";
};

export interface PaymentProvider {
  readonly name: string;
  charge(input: ChargeInput): Promise<ChargeResult>;
}
