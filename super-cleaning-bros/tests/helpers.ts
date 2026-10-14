import { loadConfig } from "../src/config.ts";
import { buildContext, type Ctx } from "../src/app/context.ts";
import { addressKey } from "../src/domain/normalize.ts";
import type { AddressDraft } from "../src/app/validate.ts";
import type { GhlClient, GhlContactWrite, GhlMessageResult, GhlOutboundMessage } from "../src/ghl/client.ts";
import type { IncomingContact } from "../src/ghl/parse.ts";
import type { ChargeInput, PaymentProvider } from "../src/payments/provider.ts";

export const office = { role: "office" as const, name: "Office" };

export class RecordingGhl implements GhlClient {
  notes: Array<{ contactId: string; body: string }> = [];
  tags: Array<{ contactId: string; tags: string[] }> = [];
  removed: string[][] = [];
  stages: Array<{ opportunityId: string; stageId: string }> = [];
  messages: GhlOutboundMessage[] = [];
  fields: Array<{ contactId: string; fieldId: string; value: string }> = [];
  private sequence = 1;

  upsertContact(input: GhlContactWrite): Promise<IncomingContact> {
    return Promise.resolve({
      id: input.id ?? `ghl_${this.sequence++}`,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      email: input.email,
      address1: input.address1,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
    });
  }

  getContact(): Promise<IncomingContact | null> {
    return Promise.resolve(null);
  }

  addNote(contactId: string, body: string): Promise<void> {
    this.notes.push({ contactId, body });
    return Promise.resolve();
  }

  addTags(contactId: string, tags: string[]): Promise<void> {
    this.tags.push({ contactId, tags });
    return Promise.resolve();
  }

  removeTags(_contactId: string, tags: string[]): Promise<void> {
    this.removed.push(tags);
    return Promise.resolve();
  }

  updateOpportunityStage(opportunityId: string, stageId: string): Promise<void> {
    this.stages.push({ opportunityId, stageId });
    return Promise.resolve();
  }

  sendConversationMessage(input: GhlOutboundMessage): Promise<GhlMessageResult> {
    this.messages.push(input);
    return Promise.resolve({ messageId: `msg_${this.messages.length}`, conversationId: "conv_test" });
  }

  setCustomField(contactId: string, fieldId: string, value: string): Promise<void> {
    this.fields.push({ contactId, fieldId, value });
    return Promise.resolve();
  }
}

export class RecordingPayments implements PaymentProvider {
  readonly name = "manual";
  charges: ChargeInput[] = [];

  charge(input: ChargeInput) {
    this.charges.push(input);
    return Promise.resolve({ providerRef: `pay_${this.charges.length}`, status: "succeeded" as const });
  }
}

export function address(line1: string, postalCode: string, city = "Erie"): AddressDraft {
  const state = "CO";
  return {
    line1,
    line2: null,
    city,
    state,
    postalCode,
    lat: null,
    lng: null,
    addressKey: addressKey({ line1, line2: null, city, state, postalCode }),
  };
}

export function app(options?: {
  ghl?: GhlClient | null;
  payments?: PaymentProvider;
  env?: NodeJS.ProcessEnv;
}) {
  const ghl = options && "ghl" in options ? options.ghl ?? null : new RecordingGhl();
  const payments = options?.payments ?? new RecordingPayments();
  const config = loadConfig({
    DATABASE_PATH: ":memory:",
    GHL_WEBHOOK_SECRET: "hook-secret",
    GHL_STAGE_SCHEDULED: "stage_scheduled",
    GHL_STAGE_IN_PROGRESS: "stage_progress",
    GHL_STAGE_DONE: "stage_done",
    GHL_STAGE_INVOICED: "stage_invoiced",
    GHL_STAGE_PAID: "stage_paid",
    ...options?.env,
  });
  let sequence = 0;
  const built = buildContext({
    config,
    ghl,
    payments,
    now: () => new Date("2026-10-14T15:00:00.000Z"),
    id: () => `id_${++sequence}`,
  });
  return { ...built, ghl: ghl as RecordingGhl, payments: payments as RecordingPayments, config };
}

export type TestApp = {
  ctx: Ctx;
  close: () => void;
  ghl: RecordingGhl;
  payments: RecordingPayments;
};
