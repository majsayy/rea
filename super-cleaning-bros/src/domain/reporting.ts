export type ReportJob = {
  status: "scheduled" | "on_my_way" | "in_progress" | "done";
  totalCents: number;
  travelFeeCents: number;
};

export type ReportPayment = {
  status: string;
  amountCents: number;
};

export type ReportInvoice = {
  status: string;
  totalCents: number;
};

export type BusinessReport = {
  jobs: number;
  jobsByStatus: { scheduled: number; on_my_way: number; in_progress: number; done: number };
  scheduledValueCents: number;
  completedValueCents: number;
  travelFeesCents: number;
  collectedCents: number;
  outstandingCents: number;
  averageCompletedTicketCents: number;
};

export function buildReport(input: {
  jobs: readonly ReportJob[];
  payments: readonly ReportPayment[];
  invoices: readonly ReportInvoice[];
}): BusinessReport {
  const jobsByStatus = { scheduled: 0, on_my_way: 0, in_progress: 0, done: 0 };
  let scheduledValueCents = 0;
  let completedValueCents = 0;
  let travelFeesCents = 0;
  for (const job of input.jobs) {
    jobsByStatus[job.status] += 1;
    scheduledValueCents += job.totalCents;
    travelFeesCents += job.travelFeeCents;
    if (job.status === "done") completedValueCents += job.totalCents;
  }
  const collectedCents = input.payments
    .filter((payment) => payment.status === "succeeded")
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const outstandingCents = input.invoices
    .filter((invoice) => invoice.status === "issued")
    .reduce((sum, invoice) => sum + invoice.totalCents, 0);
  const done = jobsByStatus.done;
  return {
    jobs: input.jobs.length,
    jobsByStatus,
    scheduledValueCents,
    completedValueCents,
    travelFeesCents,
    collectedCents,
    outstandingCents,
    averageCompletedTicketCents: done === 0 ? 0 : Math.round(completedValueCents / done),
  };
}
