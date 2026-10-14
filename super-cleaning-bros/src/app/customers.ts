import type { Address, Customer, SyncState } from "../domain/types.ts";
import { AppError, isRecord } from "../domain/errors.ts";
import { normalizePhone } from "../domain/normalize.ts";
import type { Actor } from "./actors.ts";
import { assertOffice } from "./actors.ts";
import type { Ctx } from "./context.ts";
import { existingDuplicate, pushContact, requireCustomer } from "../ghl/outbound.ts";
import {
  cleanAddress,
  cleanEmail,
  cleanPhone,
  personName,
  type AddressDraft,
} from "./validate.ts";

export type CustomerInput = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  ghlContactId: string | null;
  address: AddressDraft | null;
};

export type CustomerSaveResult = {
  customer: Customer;
  address: Address | null;
  matchedExisting: boolean;
  matchedOn: Array<"phone" | "address">;
  sync?: SyncState;
};

export function parseCustomerBody(body: unknown, requirePhone: boolean): CustomerInput {
  if (!isRecord(body)) throw new AppError("invalid_field", "Customer details are required.", 400);
  const lastName = personName(body.lastName, "Last name", true);
  const firstName = personName(body.firstName, "First name", false);
  return {
    firstName,
    lastName,
    phone: cleanPhone(body.phone, requirePhone),
    email: cleanEmail(body.email),
    ghlContactId: typeof body.ghlContactId === "string" && body.ghlContactId.trim() ? body.ghlContactId.trim() : null,
    address: cleanAddress(body.address),
  };
}

export async function saveCustomer(
  ctx: Ctx,
  actor: Actor,
  input: CustomerInput,
  options: { sync: boolean },
): Promise<CustomerSaveResult> {
  assertOffice(actor);
  input.phone = normalizePhone(input.phone);
  input.lastName = input.lastName.trim();
  if (!input.lastName) throw new AppError("invalid_field", "Last name is required.", 400);
  if (!input.phone && !input.address && !input.ghlContactId) {
    throw new AppError("invalid_field", "A customer needs a phone number or an address.", 400);
  }
  const saved = ctx.store.transaction(() => writeCustomer(ctx, input));
  const sync = options.sync ? await pushContact(ctx, saved.customer, saved.address) : undefined;
  const customer = ctx.store.getCustomer(saved.customer.id) ?? saved.customer;
  return { ...saved, customer, ...(sync ? { sync } : {}) };
}

export async function updateCustomer(
  ctx: Ctx,
  actor: Actor,
  id: string,
  body: unknown,
): Promise<CustomerSaveResult> {
  assertOffice(actor);
  const current = requireCustomer(ctx, id);
  if (!isRecord(body)) throw new AppError("invalid_field", "Customer details are required.", 400);
  const input: CustomerInput = {
    firstName: body.firstName === undefined ? current.firstName : personName(body.firstName, "First name", false),
    lastName: body.lastName === undefined ? current.lastName : personName(body.lastName, "Last name", true),
    phone: body.phone === undefined ? current.phone : cleanPhone(body.phone, true),
    email: body.email === undefined ? current.email : cleanEmail(body.email),
    ghlContactId: current.ghlContactId,
    address: null,
  };
  const duplicate = existingDuplicate(ctx, input, id);
  if (duplicate) {
    throw new AppError(
      "duplicate_customer",
      "Another customer already uses that last name and phone or address.",
      409,
    );
  }
  ctx.store.updateCustomer(id, {
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    email: input.email,
    ghlContactId: current.ghlContactId,
    stripeCustomerId: current.stripeCustomerId,
  });
  const customer = requireCustomer(ctx, id);
  const address = ctx.store.listAddresses(id)[0] ?? null;
  const sync = await pushContact(ctx, customer, address);
  return {
    customer: requireCustomer(ctx, id),
    address,
    matchedExisting: false,
    matchedOn: [],
    sync,
  };
}

export async function addAddress(ctx: Ctx, actor: Actor, customerId: string, body: unknown): Promise<Address> {
  assertOffice(actor);
  requireCustomer(ctx, customerId);
  const draft = cleanAddress(isRecord(body) ? body : null);
  if (!draft) throw new AppError("invalid_field", "Address is required.", 400);
  const existing = ctx.store.listAddresses(customerId).find((address) => address.addressKey === draft.addressKey);
  if (existing) return existing;
  return ctx.store.insertAddress(customerId, draft);
}

export function getCustomerProfile(ctx: Ctx, actor: Actor, id: string) {
  assertOffice(actor);
  const customer = requireCustomer(ctx, id);
  return {
    customer,
    addresses: ctx.store.listAddresses(id),
    card: ctx.store.getCard(id),
    acceptedEstimates: ctx.store.listAcceptedEstimates(id),
  };
}

export function listCustomerViews(ctx: Ctx, actor: Actor, query: string) {
  assertOffice(actor);
  const needle = query.trim().toLowerCase().replace(/[%_]/g, "");
  return ctx.store.listCustomers(needle).map((customer) => ({
    ...customer,
    addresses: ctx.store.listAddresses(customer.id),
    cardOnFile: ctx.store.getCard(customer.id) !== null,
  }));
}

function writeCustomer(ctx: Ctx, input: CustomerInput): CustomerSaveResult {
  const byGhl = input.ghlContactId ? ctx.store.findCustomerByGhl(input.ghlContactId) : null;
  const duplicate = byGhl ? null : existingDuplicate(ctx, input);
  const existingId = byGhl?.id ?? duplicate?.id ?? null;
  if (existingId) {
    const current = ctx.store.getCustomer(existingId);
    if (!current) throw new AppError("not_found", "Customer not found.", 404);
    const next = {
      firstName: input.firstName || current.firstName,
      lastName: input.lastName || current.lastName,
      phone: input.phone || current.phone,
      email: input.email ?? current.email,
      ghlContactId: input.ghlContactId ?? current.ghlContactId,
      stripeCustomerId: current.stripeCustomerId,
    };
    ctx.store.updateCustomer(existingId, next);
    const customer = ctx.store.getCustomer(existingId) ?? current;
    const address = input.address ? reuseOrInsert(ctx, existingId, input.address) : (ctx.store.listAddresses(existingId)[0] ?? null);
    return {
      customer,
      address,
      matchedExisting: true,
      matchedOn: byGhl ? [] : (duplicate?.matchedOn ?? []),
    };
  }
  const customer = ctx.store.insertCustomer({
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    email: input.email,
    ghlContactId: input.ghlContactId,
  });
  const address = input.address ? ctx.store.insertAddress(customer.id, input.address) : null;
  return { customer, address, matchedExisting: false, matchedOn: [] };
}

function reuseOrInsert(ctx: Ctx, customerId: string, draft: AddressDraft): Address {
  const existing = ctx.store.listAddresses(customerId).find((address) => address.addressKey === draft.addressKey);
  if (existing) return existing;
  return ctx.store.insertAddress(customerId, draft);
}
