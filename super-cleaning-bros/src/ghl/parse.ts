import { isRecord } from "../domain/errors.ts";

export type IncomingContact = {
  id: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type IncomingBooking = {
  appointmentId: string | null;
  opportunityId: string | null;
  title: string;
  start: string | null;
  end: string | null;
  monetaryCents: number | null;
  cancelled: boolean;
  contact: IncomingContact;
  addressLine: string | null;
};

export type IncomingMessage = {
  contactId: string;
  body: string;
  messageId: string | null;
  conversationId: string | null;
  channel: "sms" | "email";
};

export type ParsedGhlEvent =
  | { kind: "contact"; contact: IncomingContact }
  | { kind: "booking"; booking: IncomingBooking }
  | { kind: "message"; message: IncomingMessage }
  | { kind: "ignore"; reason: string };

export function parseGhlWebhook(payload: unknown): ParsedGhlEvent {
  if (!isRecord(payload)) return { kind: "ignore", reason: "payload was not an object" };
  const name = eventName(payload);
  if (name.includes("message") || name.includes("conversation")) {
    const direction = (stringField(payload, ["direction"]) ?? "").toLowerCase();
    if (direction.includes("outbound")) return { kind: "ignore", reason: "outbound echo" };
    const message = readInboundMessage(payload);
    if (!message) return { kind: "ignore", reason: "message payload had no contact or body" };
    return { kind: "message", message };
  }
  if (name.includes("contact") && !name.includes("delete")) {
    const contact = readContact(payload.contact ?? payload);
    if (!contact) return { kind: "ignore", reason: "contact payload had no id or name" };
    return { kind: "contact", contact };
  }
  if (
    name.includes("appointment") ||
    name.includes("opportunity") ||
    name.includes("booked") ||
    isRecord(payload.appointment)
  ) {
    if (name.includes("delete")) return { kind: "ignore", reason: "delete events are not applied" };
    const booking = readBooking(payload, name);
    if (!booking) return { kind: "ignore", reason: "booking payload had no contact" };
    return { kind: "booking", booking };
  }
  return { kind: "ignore", reason: `unsupported event ${name || "unknown"}` };
}

function eventName(body: Record<string, unknown>): string {
  const raw = body.type ?? body.event ?? body.eventType ?? "";
  return typeof raw === "string" ? raw.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

export function readContact(value: unknown): IncomingContact | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, ["id", "contactId", "contact_id"]);
  const names = splitName(value);
  const phone = stringField(value, ["phone", "phoneNumber", "mobile", "mobilePhone", "phone_number"]);
  const email = stringField(value, ["email"]);
  const address1 = stringField(value, ["address1", "address", "addressLine1"]);
  const city = stringField(value, ["city"]);
  const state = stringField(value, ["state"]);
  const postalCode = stringField(value, ["postalCode", "postal_code", "zip"]);
  if (!id && !names.lastName && !phone) return null;
  return {
    id,
    firstName: names.firstName,
    lastName: names.lastName || "Customer",
    phone: phone ?? "",
    email,
    address1,
    city,
    state,
    postalCode,
  };
}

export function readInboundMessage(body: Record<string, unknown>): IncomingMessage | null {
  const nested = isRecord(body.message) ? body.message : body;
  const contactId =
    stringField(body, ["contactId", "contact_id"]) ??
    (isRecord(body.contact) ? stringField(body.contact, ["id"]) : null) ??
    stringField(nested, ["contactId", "contact_id"]);
  const text =
    stringField(nested, ["body", "message", "text", "messageBody"]) ??
    stringField(body, ["body", "message", "text"]);
  if (!contactId || !text) return null;
  const channelName = (
    stringField(nested, ["messageType", "type"]) ??
    stringField(body, ["messageType", "type"]) ??
    ""
  ).toLowerCase();
  return {
    contactId,
    body: text,
    messageId: stringField(nested, ["messageId", "id"]) ?? stringField(body, ["messageId"]),
    conversationId: stringField(nested, ["conversationId"]) ?? stringField(body, ["conversationId"]),
    channel: channelName.includes("email") ? "email" : "sms",
  };
}

function readBooking(body: Record<string, unknown>, name: string): IncomingBooking | null {
  const appointment = isRecord(body.appointment)
    ? body.appointment
    : isRecord(body.calendar)
      ? body.calendar
      : name.includes("appointment")
        ? body
        : null;
  const opportunity = isRecord(body.opportunity)
    ? body.opportunity
    : name.includes("opportunity")
      ? body
      : null;
  const contactValue = body.contact ?? appointment?.contact ?? opportunity?.contact ?? appointment;
  const contactId =
    optionalString(appointment, ["contactId", "contact_id"]) ??
    optionalString(opportunity, ["contactId", "contact_id"]) ??
    stringField(body, ["contactId", "contact_id"]);
  const contact = readContact(contactValue) ?? (contactId ? bareContact(contactId) : null);
  if (!contact) return null;
  if (!contact.id && contactId) contact.id = contactId;
  const status = (optionalString(appointment, ["appointmentStatus", "status", "appoinmentStatus"]) ?? "").toLowerCase();
  const monetary =
    optionalNumber(opportunity, ["monetaryValue", "monetary_value"]) ??
    numberField(body, ["monetaryValue"]);
  const appointmentId = optionalString(appointment, ["id", "appointmentId", "appointment_id"]);
  const opportunityId = optionalString(opportunity, ["id", "opportunityId", "opportunity_id"]);
  return {
    appointmentId: appointment !== null && appointment === opportunity ? null : appointmentId,
    opportunityId,
    title:
      optionalString(appointment, ["title", "name"]) ??
      optionalString(opportunity, ["name", "title"]) ??
      "Cleaning",
    start: optionalString(appointment, ["startTime", "start_time", "start"]),
    end: optionalString(appointment, ["endTime", "end_time", "end"]),
    monetaryCents: monetary === null ? null : Math.round(monetary * 100),
    cancelled: status === "cancelled" || status === "canceled",
    contact,
    addressLine: optionalString(appointment, ["address"]),
  };
}

function optionalString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  return stringField(record, keys);
}

function optionalNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  return numberField(record, keys);
}

function bareContact(id: string): IncomingContact {
  return {
    id,
    firstName: "",
    lastName: "",
    phone: "",
    email: null,
    address1: null,
    city: null,
    state: null,
    postalCode: null,
  };
}

function splitName(record: Record<string, unknown>): { firstName: string; lastName: string } {
  const firstName = stringField(record, ["firstName", "first_name"]) ?? "";
  const lastName = stringField(record, ["lastName", "last_name"]) ?? "";
  if (firstName || lastName) return { firstName, lastName };
  const full = stringField(record, ["name", "fullName", "full_name"]) ?? "";
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: "", lastName: parts[0] ?? "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) ?? "" };
}

function stringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberField(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}
