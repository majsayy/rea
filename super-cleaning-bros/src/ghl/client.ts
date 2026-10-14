import { isRecord } from "../domain/errors.ts";
import { findDuplicate } from "../domain/duplicates.ts";
import { normalizePhone } from "../domain/normalize.ts";
import type { IncomingContact } from "./parse.ts";
import { readContact } from "./parse.ts";

export class GhlRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GhlRequestError";
    this.status = status;
  }
}

export type GhlContactWrite = {
  id?: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export interface GhlClient {
  upsertContact(input: GhlContactWrite): Promise<IncomingContact>;
  getContact(id: string): Promise<IncomingContact | null>;
  addNote(contactId: string, body: string): Promise<void>;
  addTags(contactId: string, tags: string[]): Promise<void>;
  removeTags(contactId: string, tags: string[]): Promise<void>;
  updateOpportunityStage(opportunityId: string, pipelineStageId: string): Promise<void>;
}

export class HttpGhlClient implements GhlClient {
  constructor(
    private readonly options: {
      token: string;
      locationId: string;
      apiBase: string;
      apiVersion: string;
      userId: string | null;
      fetchImpl: typeof fetch;
    },
  ) {}

  async upsertContact(input: GhlContactWrite): Promise<IncomingContact> {
    if (input.id) {
      const updated = await this.request("PUT", `/contacts/${encodeURIComponent(input.id)}`, this.body(input));
      return readContact(unwrapContact(updated)) ?? { ...input, id: input.id };
    }
    const query = input.phone || `${input.firstName} ${input.lastName}`.trim();
    if (query) {
      const found = await this.request(
        "GET",
        `/contacts/?locationId=${encodeURIComponent(this.options.locationId)}&query=${encodeURIComponent(query)}`,
      );
      const match = matchExisting(found, input);
      if (match?.id) {
        const updated = await this.request(
          "PUT",
          `/contacts/${encodeURIComponent(match.id)}`,
          this.body(input),
        );
        return readContact(unwrapContact(updated)) ?? { ...input, id: match.id };
      }
    }
    const created = await this.request("POST", "/contacts/", this.body(input));
    const contact = readContact(unwrapContact(created));
    if (!contact?.id) throw new GhlRequestError(502, "GoHighLevel did not return a contact id");
    return contact;
  }

  async getContact(id: string): Promise<IncomingContact | null> {
    const payload = await this.request("GET", `/contacts/${encodeURIComponent(id)}`, undefined, true);
    if (payload === null) return null;
    return readContact(unwrapContact(payload));
  }

  async addNote(contactId: string, body: string): Promise<void> {
    const note: Record<string, string> = { body };
    if (this.options.userId) note.userId = this.options.userId;
    await this.request("POST", `/contacts/${encodeURIComponent(contactId)}/notes`, note);
  }

  async addTags(contactId: string, tags: string[]): Promise<void> {
    await this.request("POST", `/contacts/${encodeURIComponent(contactId)}/tags`, { tags });
  }

  async removeTags(contactId: string, tags: string[]): Promise<void> {
    await this.request("DELETE", `/contacts/${encodeURIComponent(contactId)}/tags`, { tags }, true);
  }

  async updateOpportunityStage(opportunityId: string, pipelineStageId: string): Promise<void> {
    await this.request("PUT", `/opportunities/${encodeURIComponent(opportunityId)}`, {
      pipelineStageId,
    });
  }

  private body(input: GhlContactWrite): Record<string, string> {
    const phone = normalizePhone(input.phone);
    const payload: Record<string, string> = {
      firstName: input.firstName,
      lastName: input.lastName,
      locationId: this.options.locationId,
      source: "Super Cleaning Bros",
    };
    if (phone.length === 10) payload.phone = `+1${phone}`;
    else if (phone) payload.phone = phone;
    if (input.email) payload.email = input.email;
    if (input.address1) payload.address1 = input.address1;
    if (input.city) payload.city = input.city;
    if (input.state) payload.state = input.state;
    if (input.postalCode) payload.postalCode = input.postalCode;
    return payload;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    allowNotFound = false,
  ): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        Version: this.options.apiVersion,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await this.options.fetchImpl(`${this.options.apiBase}${path}`, init);
    if (allowNotFound && response.status === 404) return null;
    const text = await response.text();
    if (!response.ok) {
      throw new GhlRequestError(
        response.status,
        `GoHighLevel ${method} ${path} failed (${response.status}): ${text.slice(0, 300)}`,
      );
    }
    if (!text) return null;
    return JSON.parse(text) as unknown;
  }
}

function unwrapContact(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  if (isRecord(payload.contact)) return payload.contact;
  return payload;
}

function matchExisting(payload: unknown, input: GhlContactWrite): IncomingContact | null {
  if (!isRecord(payload) || !Array.isArray(payload.contacts)) return null;
  const contacts = payload.contacts.flatMap((item) => {
    const contact = readContact(item);
    return contact ? [contact] : [];
  });
  const match = findDuplicate(
    contacts.map((contact) => ({
      id: contact.id ?? "",
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      addressKeys: [],
    })),
    { lastName: input.lastName, phone: input.phone, addressKeys: [] },
  );
  if (!match) return null;
  return contacts.find((contact) => contact.id === match.id) ?? null;
}
