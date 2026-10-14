import { csvRecords } from "../domain/csv.ts";
import { AppError } from "../domain/errors.ts";
import { dollarsToCents } from "../domain/money.ts";
import { addressKey, postalDigits } from "../domain/normalize.ts";
import type { Actor } from "./actors.ts";
import { assertOffice } from "./actors.ts";
import type { Ctx } from "./context.ts";
import { saveCustomer } from "./customers.ts";
import { createJob } from "./jobs.ts";

export async function importCustomers(ctx: Ctx, actor: Actor, csv: string) {
  assertOffice(actor);
  if (csv.length > 2_000_000) throw new AppError("body_too_large", "CSV file is too large.", 413);
  const records = csvRecords(csv);
  let created = 0;
  let matched = 0;
  let jobs = 0;
  const errors: Array<{ line: number; message: string }> = [];
  for (const [index, record] of records.entries()) {
    const line = index + 2;
    try {
      const phone = pick(record, ["phone", "mobile_number", "mobile", "phone_number", "home_number"]);
      const result = await saveCustomer(
        ctx,
        actor,
        {
          firstName: pick(record, ["first_name", "firstname"]),
          lastName: pick(record, ["last_name", "lastname"]),
          phone,
          email: pick(record, ["email"]) || null,
          ghlContactId: null,
          address: addressFrom(record),
        },
        { sync: true },
      );
      if (result.matchedExisting) matched += 1;
      else created += 1;
      const when = pick(record, ["scheduled_start", "start", "job_date", "scheduled_date"]);
      if (when) {
        if (!result.address) throw new AppError("invalid_field", "A job import needs an address.", 400);
        const amount = pick(record, ["service_dollars", "total", "amount", "job_total"]);
        if (!amount) throw new AppError("invalid_amount", "A job import needs a dollar total.", 400);
        const status = mapStatus(pick(record, ["status"]));
        if (status === "skip") {
          errors.push({ line, message: "Skipped a cancelled job." });
          continue;
        }
        await createJob(ctx, actor, {
          customerId: result.customer.id,
          addressId: result.address.id,
          title: pick(record, ["job_title", "title", "description"]) || "Cleaning",
          scheduledStart: when,
          scheduledEnd: pick(record, ["scheduled_end", "end"]) || undefined,
          lockedTotalCents: dollarsToCents(amount),
          status,
          technicianIds: [],
        });
        jobs += 1;
      }
    } catch (error) {
      errors.push({ line, message: error instanceof Error ? error.message : "Could not import this row." });
    }
  }
  return { created, matched, jobs, errors };
}

function addressFrom(record: Record<string, string>) {
  const line1 = pick(record, ["address_line1", "address", "street", "address1"]);
  const postalCode = postalDigits(pick(record, ["postal_code", "zip", "zip_code"]));
  if (!line1 || !postalCode) return null;
  const line2 = pick(record, ["address_line2", "address2"]) || null;
  const city = pick(record, ["city"]);
  const state = pick(record, ["state"]).slice(0, 2).toUpperCase();
  return {
    line1,
    line2,
    city,
    state,
    postalCode,
    lat: null,
    lng: null,
    addressKey: addressKey({ line1, line2, city, state, postalCode }),
  };
}

function mapStatus(value: string): "scheduled" | "in_progress" | "done" | "skip" {
  const status = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (status === "cancelled" || status === "canceled") return "skip";
  if (status === "in_progress" || status === "inprogress") return "in_progress";
  if (status === "done" || status === "completed" || status === "complete") return "done";
  return "scheduled";
}

function pick(record: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value && value.trim()) return value.trim();
  }
  return "";
}
