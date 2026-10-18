import { buildReport } from "../domain/reporting.ts";
import { AppError } from "../domain/errors.ts";
import { parseRangeStart } from "../domain/time.ts";
import type { Actor } from "./actors.ts";
import { assertOffice } from "./actors.ts";
import type { Ctx } from "./context.ts";

export function businessReport(ctx: Ctx, actor: Actor, fromRaw: string, toRaw: string) {
  assertOffice(actor);
  const from = parseRangeStart(fromRaw, "From");
  const to = parseRangeStart(toRaw, "To");
  const span = new Date(to).getTime() - new Date(from).getTime();
  if (span <= 0 || span > 370 * 24 * 60 * 60 * 1000) {
    throw new AppError("invalid_time", "Choose a reporting range up to one year.", 400);
  }
  const jobs = ctx.store.listJobs(from, to);
  const payments = ctx.store.listPaymentsBetween(from, to);
  const invoices = ctx.store.listIssuedInvoicesForJobs(jobs.map((job) => job.id));
  return {
    from,
    to,
    ...buildReport({ jobs, payments, invoices }),
  };
}
