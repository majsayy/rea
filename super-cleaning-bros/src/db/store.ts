import type { DatabaseSync } from "node:sqlite";

import type {
  Address,
  AuditEntry,
  CardOnFile,
  ChangeOrder,
  Customer,
  CustomerMessage,
  Estimate,
  Invoice,
  Job,
  JobNote,
  JobStatus,
  LineItem,
  MessageTemplate,
  Payment,
  PhotoKind,
  PhotoMeta,
  Technician,
} from "../domain/types.ts";
import { isRecord } from "../domain/errors.ts";

type Row = Record<string, unknown>;
type Sql = string | number | bigint | Uint8Array | null;

export class Store {
  constructor(
    readonly db: DatabaseSync,
    readonly now: () => Date,
    readonly id: () => string,
  ) {}

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  private get(sql: string, ...params: Sql[]): Row | null {
    const row = this.db.prepare(sql).get(...params);
    if (row === undefined) return null;
    return row as Row;
  }

  private all(sql: string, ...params: Sql[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  private run(sql: string, ...params: Sql[]): void {
    this.db.prepare(sql).run(...params);
  }

  private changes(sql: string, ...params: Sql[]): number {
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  insertCustomer(input: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    ghlContactId: string | null;
  }): Customer {
    const customer: Customer = {
      id: this.id(),
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      email: input.email,
      ghlContactId: input.ghlContactId,
      stripeCustomerId: null,
      createdAt: this.stamp(),
      updatedAt: this.stamp(),
    };
    this.run(
      `INSERT INTO customers (
        id, first_name, last_name, phone, email, ghl_contact_id, stripe_customer_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      customer.id,
      customer.firstName,
      customer.lastName,
      customer.phone,
      customer.email,
      customer.ghlContactId,
      customer.stripeCustomerId,
      customer.createdAt,
      customer.updatedAt,
    );
    return customer;
  }

  updateCustomer(
    id: string,
    input: {
      firstName: string;
      lastName: string;
      phone: string;
      email: string | null;
      ghlContactId: string | null;
      stripeCustomerId: string | null;
    },
  ): void {
    this.run(
      `UPDATE customers
       SET first_name = ?, last_name = ?, phone = ?, email = ?, ghl_contact_id = ?, stripe_customer_id = ?, updated_at = ?
       WHERE id = ?`,
      input.firstName,
      input.lastName,
      input.phone,
      input.email,
      input.ghlContactId,
      input.stripeCustomerId,
      this.stamp(),
      id,
    );
  }

  getCustomer(id: string): Customer | null {
    const row = this.get("SELECT * FROM customers WHERE id = ?", id);
    return row ? mapCustomer(row) : null;
  }

  findCustomerByGhl(ghlContactId: string): Customer | null {
    const row = this.get("SELECT * FROM customers WHERE ghl_contact_id = ?", ghlContactId);
    return row ? mapCustomer(row) : null;
  }

  findCustomerByStripe(stripeCustomerId: string): Customer | null {
    const row = this.get("SELECT * FROM customers WHERE stripe_customer_id = ?", stripeCustomerId);
    return row ? mapCustomer(row) : null;
  }

  listCustomers(needle: string): Customer[] {
    return this.all(
      `SELECT * FROM customers
       WHERE length(?) = 0
          OR lower(last_name) LIKE '%' || ? || '%'
          OR lower(first_name) LIKE '%' || ? || '%'
          OR phone LIKE '%' || ? || '%'
          OR lower(ifnull(email, '')) LIKE '%' || ? || '%'
       ORDER BY last_name, first_name
       LIMIT 200`,
      needle,
      needle,
      needle,
      needle,
      needle,
    ).map(mapCustomer);
  }

  matchCandidates(): Array<{
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    addressKeys: string[];
  }> {
    const rows = this.all(
      `SELECT c.id, c.first_name, c.last_name, c.phone, a.address_key
       FROM customers c
       LEFT JOIN addresses a ON a.customer_id = c.id
       ORDER BY c.created_at`,
    );
    const grouped = new Map<
      string,
      { id: string; firstName: string; lastName: string; phone: string; addressKeys: string[] }
    >();
    for (const row of rows) {
      const id = text(row, "id");
      const current = grouped.get(id) ?? {
        id,
        firstName: text(row, "first_name"),
        lastName: text(row, "last_name"),
        phone: text(row, "phone"),
        addressKeys: [],
      };
      const key = textOrNull(row, "address_key");
      if (key) current.addressKeys.push(key);
      grouped.set(id, current);
    }
    return [...grouped.values()];
  }

  insertAddress(
    customerId: string,
    input: {
      line1: string;
      line2: string | null;
      city: string;
      state: string;
      postalCode: string;
      lat: number | null;
      lng: number | null;
      addressKey: string;
    },
  ): Address {
    const address: Address = { id: this.id(), customerId, ...input };
    this.run(
      `INSERT INTO addresses (
        id, customer_id, line1, line2, city, state, postal_code, lat, lng, address_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      address.id,
      address.customerId,
      address.line1,
      address.line2,
      address.city,
      address.state,
      address.postalCode,
      address.lat,
      address.lng,
      address.addressKey,
    );
    return address;
  }

  updateAddress(address: Address): void {
    this.run(
      `UPDATE addresses
       SET line1 = ?, line2 = ?, city = ?, state = ?, postal_code = ?, lat = ?, lng = ?, address_key = ?
       WHERE id = ?`,
      address.line1,
      address.line2,
      address.city,
      address.state,
      address.postalCode,
      address.lat,
      address.lng,
      address.addressKey,
      address.id,
    );
  }

  getAddress(id: string): Address | null {
    const row = this.get("SELECT * FROM addresses WHERE id = ?", id);
    return row ? mapAddress(row) : null;
  }

  listAddresses(customerId: string): Address[] {
    return this.all(
      "SELECT * FROM addresses WHERE customer_id = ? ORDER BY rowid",
      customerId,
    ).map(mapAddress);
  }

  insertTechnician(input: { name: string; phone: string | null; pinHash: string }): Technician {
    const technician: Technician = {
      id: this.id(),
      name: input.name,
      phone: input.phone,
      active: true,
      createdAt: this.stamp(),
    };
    this.run(
      `INSERT INTO technicians (id, name, phone, pin_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
      technician.id,
      technician.name,
      technician.phone,
      input.pinHash,
      technician.createdAt,
    );
    return technician;
  }

  listTechnicians(): Technician[] {
    return this.all("SELECT id, name, phone, active, created_at FROM technicians ORDER BY name").map(
      mapTechnician,
    );
  }

  getTechnician(id: string): (Technician & { pinHash: string }) | null {
    const row = this.get("SELECT * FROM technicians WHERE id = ?", id);
    if (!row) return null;
    return { ...mapTechnician(row), pinHash: text(row, "pin_hash") };
  }

  findTechnicianByName(name: string): (Technician & { pinHash: string }) | null {
    const row = this.get(
      "SELECT * FROM technicians WHERE lower(name) = lower(?) AND active = 1",
      name,
    );
    if (!row) return null;
    return { ...mapTechnician(row), pinHash: text(row, "pin_hash") };
  }

  insertEstimate(input: Omit<Estimate, "id" | "createdAt" | "acceptedAt"> & { acceptedAt?: string | null }): Estimate {
    const estimate: Estimate = {
      ...input,
      id: this.id(),
      acceptedAt: input.acceptedAt ?? null,
      createdAt: this.stamp(),
    };
    this.run(
      `INSERT INTO estimates (
        id, customer_id, address_id, status, service_cents, travel_fee_cents, total_cents,
        drive_minutes, travel_basis, travel_review_required, price_locked, locked_from_estimate_id,
        line_items_json, accepted_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      estimate.id,
      estimate.customerId,
      estimate.addressId,
      estimate.status,
      estimate.serviceCents,
      estimate.travelFeeCents,
      estimate.totalCents,
      estimate.driveMinutes,
      estimate.travelBasis,
      estimate.travelReviewRequired ? 1 : 0,
      estimate.priceLocked ? 1 : 0,
      estimate.lockedFromEstimateId,
      JSON.stringify(estimate.lineItems),
      estimate.acceptedAt,
      estimate.createdAt,
    );
    return estimate;
  }

  markEstimate(id: string, status: "accepted" | "declined", acceptedAt: string | null): void {
    this.run(
      "UPDATE estimates SET status = ?, accepted_at = ? WHERE id = ?",
      status,
      acceptedAt,
      id,
    );
  }

  getEstimate(id: string): Estimate | null {
    const row = this.get("SELECT * FROM estimates WHERE id = ?", id);
    return row ? mapEstimate(row) : null;
  }

  listEstimates(): Estimate[] {
    return this.all("SELECT * FROM estimates ORDER BY created_at DESC LIMIT 200").map(mapEstimate);
  }

  latestAcceptedEstimate(customerId: string, addressId: string): Estimate | null {
    const row = this.get(
      `SELECT * FROM estimates
       WHERE customer_id = ? AND address_id = ? AND status = 'accepted'
       ORDER BY accepted_at DESC LIMIT 1`,
      customerId,
      addressId,
    );
    return row ? mapEstimate(row) : null;
  }

  listAcceptedEstimates(customerId: string): Estimate[] {
    return this.all(
      `SELECT * FROM estimates WHERE customer_id = ? AND status = 'accepted' ORDER BY accepted_at DESC`,
      customerId,
    ).map(mapEstimate);
  }

  insertJob(input: Omit<Job, "id" | "createdAt" | "updatedAt"> & { technicianIds: string[] }): Job {
    const timestamp = this.stamp();
    const job: Job = {
      id: this.id(),
      customerId: input.customerId,
      addressId: input.addressId,
      estimateId: input.estimateId,
      title: input.title,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      status: input.status,
      priceLocked: input.priceLocked,
      serviceCents: input.serviceCents,
      travelFeeCents: input.travelFeeCents,
      totalCents: input.totalCents,
      lineItems: input.lineItems,
      postWalkthroughComplete: input.postWalkthroughComplete,
      ghlOpportunityId: input.ghlOpportunityId,
      ghlAppointmentId: input.ghlAppointmentId,
      unscheduled: input.unscheduled,
      arrivalStart: input.arrivalStart,
      arrivalEnd: input.arrivalEnd,
      accessNotes: input.accessNotes,
      shareToken: input.shareToken,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.run(
      `INSERT INTO jobs (
        id, customer_id, address_id, estimate_id, title, scheduled_start, scheduled_end, status,
        price_locked, service_cents, travel_fee_cents, total_cents, line_items_json, post_walkthrough,
        ghl_opportunity_id, ghl_appointment_id, unscheduled, arrival_start, arrival_end, access_notes,
        share_token, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      job.id,
      job.customerId,
      job.addressId,
      job.estimateId,
      job.title,
      job.scheduledStart,
      job.scheduledEnd,
      job.status,
      job.priceLocked ? 1 : 0,
      job.serviceCents,
      job.travelFeeCents,
      job.totalCents,
      JSON.stringify(job.lineItems),
      job.postWalkthroughComplete ? 1 : 0,
      job.ghlOpportunityId,
      job.ghlAppointmentId,
      job.unscheduled ? 1 : 0,
      job.arrivalStart,
      job.arrivalEnd,
      job.accessNotes,
      job.shareToken,
      job.createdAt,
      job.updatedAt,
    );
    this.replaceAssignments(job.id, input.technicianIds);
    return job;
  }

  replaceAssignments(jobId: string, technicianIds: string[]): void {
    this.run("DELETE FROM job_assignments WHERE job_id = ?", jobId);
    for (const technicianId of technicianIds) {
      this.run(
        "INSERT INTO job_assignments (job_id, technician_id) VALUES (?, ?)",
        jobId,
        technicianId,
      );
    }
  }

  assignmentIds(jobId: string): string[] {
    return this.all("SELECT technician_id FROM job_assignments WHERE job_id = ?", jobId).map((row) =>
      text(row, "technician_id"),
    );
  }

  updateJobSchedule(
    id: string,
    input: {
      title: string;
      scheduledStart: string;
      scheduledEnd: string;
      status: JobStatus;
      postWalkthroughComplete: boolean;
      unscheduled: boolean;
      arrivalStart: string | null;
      arrivalEnd: string | null;
      accessNotes: string | null;
    },
  ): void {
    this.run(
      `UPDATE jobs
       SET title = ?, scheduled_start = ?, scheduled_end = ?, status = ?, post_walkthrough = ?,
           unscheduled = ?, arrival_start = ?, arrival_end = ?, access_notes = ?, updated_at = ?
       WHERE id = ?`,
      input.title,
      input.scheduledStart,
      input.scheduledEnd,
      input.status,
      input.postWalkthroughComplete ? 1 : 0,
      input.unscheduled ? 1 : 0,
      input.arrivalStart,
      input.arrivalEnd,
      input.accessNotes,
      this.stamp(),
      id,
    );
  }

  setShareToken(id: string, token: string): string | null {
    this.run(
      `UPDATE jobs SET share_token = ?, updated_at = ? WHERE id = ? AND share_token IS NULL`,
      token,
      this.stamp(),
      id,
    );
    return this.getJob(id)?.shareToken ?? null;
  }

  updateJobPrice(id: string, serviceCents: number, totalCents: number, lineItems: LineItem[]): void {
    this.run(
      `UPDATE jobs SET service_cents = ?, total_cents = ?, line_items_json = ?, updated_at = ? WHERE id = ?`,
      serviceCents,
      totalCents,
      JSON.stringify(lineItems),
      this.stamp(),
      id,
    );
  }

  getJob(id: string): Job | null {
    const row = this.get("SELECT * FROM jobs WHERE id = ?", id);
    return row ? mapJob(row) : null;
  }

  findJobByAppointment(appointmentId: string): Job | null {
    const row = this.get("SELECT * FROM jobs WHERE ghl_appointment_id = ?", appointmentId);
    return row ? mapJob(row) : null;
  }

  findJobByOpportunity(opportunityId: string): Job | null {
    const row = this.get("SELECT * FROM jobs WHERE ghl_opportunity_id = ?", opportunityId);
    return row ? mapJob(row) : null;
  }

  listJobs(fromIso: string, toIso: string): Job[] {
    return this.all(
      `SELECT * FROM jobs
       WHERE unscheduled = 0 AND scheduled_start >= ? AND scheduled_start < ?
       ORDER BY scheduled_start`,
      fromIso,
      toIso,
    ).map(mapJob);
  }

  listUnscheduled(): Job[] {
    return this.all(`SELECT * FROM jobs WHERE unscheduled = 1 ORDER BY created_at DESC`).map(mapJob);
  }

  jobsForCustomer(customerId: string): Job[] {
    return this.all(`SELECT * FROM jobs WHERE customer_id = ? ORDER BY scheduled_start DESC`, customerId).map(mapJob);
  }

  findJobByShareToken(token: string): Job | null {
    const row = this.get("SELECT * FROM jobs WHERE share_token = ?", token);
    return row ? mapJob(row) : null;
  }

  insertNote(jobId: string, authorName: string, body: string): JobNote {
    const note: JobNote = {
      id: this.id(),
      jobId,
      authorName,
      body,
      visibility: "internal",
      createdAt: this.stamp(),
    };
    this.run(
      "INSERT INTO job_notes (id, job_id, author_name, body, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      note.id,
      note.jobId,
      note.authorName,
      note.body,
      note.visibility,
      note.createdAt,
    );
    return note;
  }

  updateNote(jobId: string, noteId: string, body: string): { previous: string; note: JobNote } | null {
    const current = this.listNotes(jobId).find((note) => note.id === noteId);
    if (!current) return null;
    this.run("UPDATE job_notes SET body = ? WHERE id = ? AND job_id = ?", body, noteId, jobId);
    return { previous: current.body, note: { ...current, body } };
  }

  listNotes(jobId: string): JobNote[] {
    return this.all(
      "SELECT * FROM job_notes WHERE job_id = ? ORDER BY created_at",
      jobId,
    ).map(mapNote);
  }

  insertPhoto(jobId: string, kind: PhotoKind, contentType: string, bytes: Buffer): PhotoMeta {
    const photo = {
      id: this.id(),
      jobId,
      kind,
      contentType,
      byteLength: bytes.length,
      createdAt: this.stamp(),
    };
    this.run(
      "INSERT INTO photos (id, job_id, kind, content_type, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      photo.id,
      photo.jobId,
      photo.kind,
      photo.contentType,
      bytes,
      photo.createdAt,
    );
    return photo;
  }

  countPhotos(jobId: string): number {
    const row = this.get("SELECT COUNT(*) AS count FROM photos WHERE job_id = ?", jobId);
    return row ? integer(row, "count") : 0;
  }

  countPhotosByKind(jobId: string, kind: PhotoKind): number {
    const row = this.get(
      "SELECT COUNT(*) AS count FROM photos WHERE job_id = ? AND kind = ?",
      jobId,
      kind,
    );
    return row ? integer(row, "count") : 0;
  }

  listPhotoMeta(jobId: string): PhotoMeta[] {
    return this.all(
      `SELECT id, job_id, kind, content_type, length(bytes) AS byte_length, created_at
       FROM photos WHERE job_id = ? ORDER BY created_at`,
      jobId,
    ).map((row) => ({
      id: text(row, "id"),
      jobId: text(row, "job_id"),
      kind: text(row, "kind") as PhotoKind,
      contentType: text(row, "content_type"),
      byteLength: integer(row, "byte_length"),
      createdAt: text(row, "created_at"),
    }));
  }

  getPhoto(jobId: string, photoId: string): { meta: PhotoMeta; bytes: Uint8Array } | null {
    const row = this.get(
      "SELECT id, job_id, kind, content_type, bytes, length(bytes) AS byte_length, created_at FROM photos WHERE id = ? AND job_id = ?",
      photoId,
      jobId,
    );
    if (!row) return null;
    const bytes = row.bytes;
    if (!(bytes instanceof Uint8Array)) return null;
    return {
      meta: {
        id: text(row, "id"),
        jobId: text(row, "job_id"),
        kind: text(row, "kind") as PhotoKind,
        contentType: text(row, "content_type"),
        byteLength: integer(row, "byte_length"),
        createdAt: text(row, "created_at"),
      },
      bytes,
    };
  }

  upsertCard(card: Omit<CardOnFile, "updatedAt">): CardOnFile {
    const saved: CardOnFile = { ...card, updatedAt: this.stamp() };
    this.run(
      `INSERT INTO cards (
        customer_id, provider, provider_customer_id, provider_payment_method_id, brand, last4, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(customer_id) DO UPDATE SET
        provider = excluded.provider,
        provider_customer_id = excluded.provider_customer_id,
        provider_payment_method_id = excluded.provider_payment_method_id,
        brand = excluded.brand,
        last4 = excluded.last4,
        updated_at = excluded.updated_at`,
      saved.customerId,
      saved.provider,
      saved.providerCustomerId,
      saved.providerPaymentMethodId,
      saved.brand,
      saved.last4,
      saved.updatedAt,
    );
    return saved;
  }

  getCard(customerId: string): CardOnFile | null {
    const row = this.get("SELECT * FROM cards WHERE customer_id = ?", customerId);
    if (!row) return null;
    return {
      customerId: text(row, "customer_id"),
      provider: text(row, "provider"),
      providerCustomerId: text(row, "provider_customer_id"),
      providerPaymentMethodId: text(row, "provider_payment_method_id"),
      brand: textOrNull(row, "brand"),
      last4: textOrNull(row, "last4"),
      updatedAt: text(row, "updated_at"),
    };
  }

  nextInvoiceNumber(): string {
    const row = this.get("SELECT COUNT(*) AS count FROM invoices");
    return `SCB-${1001 + (row ? integer(row, "count") : 0)}`;
  }

  insertInvoice(input: Omit<Invoice, "id" | "number" | "createdAt">): Invoice {
    const invoice: Invoice = {
      ...input,
      id: this.id(),
      number: this.nextInvoiceNumber(),
      createdAt: this.stamp(),
    };
    this.run(
      `INSERT INTO invoices (
        id, job_id, customer_id, number, total_cents, service_cents, travel_fee_cents, status,
        line_items_json, issued_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      invoice.id,
      invoice.jobId,
      invoice.customerId,
      invoice.number,
      invoice.totalCents,
      invoice.serviceCents,
      invoice.travelFeeCents,
      invoice.status,
      JSON.stringify(invoice.lineItems),
      invoice.issuedAt,
      invoice.createdAt,
    );
    return invoice;
  }

  getInvoice(id: string): Invoice | null {
    const row = this.get("SELECT * FROM invoices WHERE id = ?", id);
    return row ? mapInvoice(row) : null;
  }

  latestInvoiceForJob(jobId: string): Invoice | null {
    const row = this.get(
      "SELECT * FROM invoices WHERE job_id = ? AND status != 'void' ORDER BY created_at DESC LIMIT 1",
      jobId,
    );
    return row ? mapInvoice(row) : null;
  }

  invoiceBriefs(jobIds: readonly string[]): Map<string, { id: string; number: string; status: string; totalCents: number }> {
    const briefs = new Map<string, { id: string; number: string; status: string; totalCents: number }>();
    if (jobIds.length === 0) return briefs;
    const placeholders = jobIds.map(() => "?").join(", ");
    const rows = this.all(
      `SELECT id, job_id, number, status, total_cents FROM invoices
       WHERE status != 'void' AND job_id IN (${placeholders})
       ORDER BY created_at DESC`,
      ...jobIds,
    );
    for (const row of rows) {
      const jobId = text(row, "job_id");
      if (briefs.has(jobId)) continue;
      briefs.set(jobId, {
        id: text(row, "id"),
        number: text(row, "number"),
        status: text(row, "status"),
        totalCents: integer(row, "total_cents"),
      });
    }
    return briefs;
  }

  markInvoicePaid(id: string): void {
    this.run("UPDATE invoices SET status = 'paid' WHERE id = ?", id);
  }

  insertPayment(input: Omit<Payment, "id" | "createdAt">): Payment {
    const payment: Payment = { ...input, id: this.id(), createdAt: this.stamp() };
    this.run(
      `INSERT INTO payments (
        id, invoice_id, job_id, amount_cents, status, provider, provider_ref, blocked_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      payment.id,
      payment.invoiceId,
      payment.jobId,
      payment.amountCents,
      payment.status,
      payment.provider,
      payment.providerRef,
      payment.blockedReason,
      payment.createdAt,
    );
    return payment;
  }

  succeededPayment(invoiceId: string): Payment | null {
    const row = this.get(
      "SELECT * FROM payments WHERE invoice_id = ? AND status = 'succeeded' ORDER BY created_at LIMIT 1",
      invoiceId,
    );
    return row ? mapPayment(row) : null;
  }

  listPaymentsBetween(fromIso: string, toIso: string): Payment[] {
    return this.all(
      "SELECT * FROM payments WHERE created_at >= ? AND created_at < ? ORDER BY created_at",
      fromIso,
      toIso,
    ).map(mapPayment);
  }

  listIssuedInvoicesForJobs(jobIds: string[]): Invoice[] {
    if (jobIds.length === 0) return [];
    const placeholders = jobIds.map(() => "?").join(", ");
    return this.all(
      `SELECT * FROM invoices WHERE status = 'issued' AND job_id IN (${placeholders})`,
      ...jobIds,
    ).map(mapInvoice);
  }

  insertEvent(input: {
    direction: "inbound" | "outbound";
    eventType: string;
    payload: unknown;
    status: string;
    detail: string | null;
  }): void {
    this.run(
      `INSERT INTO ghl_events (id, direction, event_type, payload_json, status, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      this.id(),
      input.direction,
      input.eventType,
      JSON.stringify(input.payload),
      input.status,
      input.detail,
      this.stamp(),
    );
  }

  listEvents(limit = 50): Array<{
    id: string;
    direction: string;
    eventType: string;
    status: string;
    detail: string | null;
    createdAt: string;
  }> {
    return this.all(
      "SELECT id, direction, event_type, status, detail, created_at FROM ghl_events ORDER BY created_at DESC LIMIT ?",
      limit,
    ).map((row) => ({
      id: text(row, "id"),
      direction: text(row, "direction"),
      eventType: text(row, "event_type"),
      status: text(row, "status"),
      detail: textOrNull(row, "detail"),
      createdAt: text(row, "created_at"),
    }));
  }

  hasReceipt(id: string): boolean {
    return this.get("SELECT id FROM webhook_receipts WHERE id = ?", id) !== null;
  }

  insertReceipt(id: string): void {
    this.run(
      "INSERT INTO webhook_receipts (id, received_at) VALUES (?, ?)",
      id,
      this.stamp(),
    );
  }

  deleteReceipt(id: string): void {
    this.run("DELETE FROM webhook_receipts WHERE id = ?", id);
  }

  claimMessage(
    input: Omit<CustomerMessage, "id" | "createdAt" | "ghlMessageId" | "ghlConversationId" | "detail" | "sendAfter">,
  ): {
    proceed: boolean;
    message: CustomerMessage;
  } {
    const existing = this.messageByKey(input.idempotencyKey);
    if (
      existing &&
      (existing.status === "sent" || existing.status === "sending" || existing.status === "held" || sundaySkip(existing))
    ) {
      return { proceed: false, message: existing };
    }
    if (existing) {
      this.run(
        `UPDATE messages SET status = 'sending', body = ?, subject = ?, channel = ?, detail = NULL, send_after = NULL
         WHERE id = ? AND (
           status = 'failed'
           OR (status = 'skipped' AND IFNULL(detail, '') != 'sunday_not_useful')
         )`,
        input.body,
        input.subject,
        input.channel,
        existing.id,
      );
      const updated = this.getMessage(existing.id);
      if (!updated || updated.status !== "sending") return { proceed: false, message: existing };
      return { proceed: true, message: updated };
    }
    const message: CustomerMessage = {
      ...input,
      id: this.id(),
      ghlMessageId: null,
      ghlConversationId: null,
      detail: null,
      sendAfter: null,
      createdAt: this.stamp(),
    };
    try {
      this.insertMessage(message);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        const raced = this.messageByKey(input.idempotencyKey);
        if (raced) return { proceed: false, message: raced };
      }
      throw error;
    }
    return { proceed: true, message };
  }

  completeMessage(
    id: string,
    status: CustomerMessage["status"],
    extra: { ghlMessageId: string | null; ghlConversationId: string | null; detail: string | null },
  ): void {
    this.run(
      `UPDATE messages SET status = ?, ghl_message_id = ?, ghl_conversation_id = ?, detail = ? WHERE id = ?`,
      status,
      extra.ghlMessageId,
      extra.ghlConversationId,
      extra.detail,
      id,
    );
  }

  markHeld(id: string, sendAfter: string): void {
    this.run(
      `UPDATE messages SET status = 'held', send_after = ?, detail = 'sunday_hold' WHERE id = ?`,
      sendAfter,
      id,
    );
  }

  listHeldDue(nowIso: string): CustomerMessage[] {
    return this.all(
      `SELECT * FROM messages
       WHERE status = 'held' AND send_after IS NOT NULL AND send_after <= ?
       ORDER BY send_after, created_at`,
      nowIso,
    ).map(mapMessage);
  }

  claimHeld(id: string): CustomerMessage | null {
    const changes = this.changes(`UPDATE messages SET status = 'sending' WHERE id = ? AND status = 'held'`, id);
    if (changes !== 1) return null;
    return this.getMessage(id);
  }

  messageById(id: string): CustomerMessage | null {
    return this.getMessage(id);
  }

  listMessagesForCustomer(customerId: string): CustomerMessage[] {
    return this.all(
      `SELECT * FROM messages WHERE customer_id = ? ORDER BY created_at`,
      customerId,
    ).map(mapMessage);
  }

  ensureTemplates(
    defaults: ReadonlyArray<{ key: string; channel: "sms" | "email"; subject: string | null; body: string }>,
  ): MessageTemplate[] {
    for (const template of defaults) {
      const existing = this.get("SELECT key FROM message_templates WHERE key = ?", template.key);
      if (existing) continue;
      this.run(
        `INSERT INTO message_templates (key, channel, subject, body, updated_at) VALUES (?, ?, ?, ?, ?)`,
        template.key,
        template.channel,
        template.subject,
        template.body,
        this.stamp(),
      );
    }
    return this.listTemplates();
  }

  listTemplates(): MessageTemplate[] {
    return this.all(`SELECT * FROM message_templates ORDER BY key`).map((row) => ({
      key: text(row, "key"),
      channel: text(row, "channel") === "email" ? "email" : "sms",
      subject: textOrNull(row, "subject"),
      body: text(row, "body"),
      updatedAt: text(row, "updated_at"),
    }));
  }

  saveTemplate(input: { key: string; channel: "sms" | "email"; subject: string | null; body: string }): void {
    this.run(
      `INSERT INTO message_templates (key, channel, subject, body, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET channel = excluded.channel, subject = excluded.subject, body = excluded.body, updated_at = excluded.updated_at`,
      input.key,
      input.channel,
      input.subject,
      input.body,
      this.stamp(),
    );
  }

  insertChangeOrder(input: Omit<ChangeOrder, "id" | "createdAt" | "resolvedAt" | "resolvedBy">): ChangeOrder {
    const order: ChangeOrder = {
      ...input,
      id: this.id(),
      createdAt: this.stamp(),
      resolvedAt: null,
      resolvedBy: null,
    };
    this.run(
      `INSERT INTO change_orders (
        id, job_id, author_name, status, customer_approved, previous_json, next_json,
        previous_total_cents, next_total_cents, reason, created_at, resolved_at, resolved_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      order.id,
      order.jobId,
      order.authorName,
      order.status,
      order.customerApproved ? 1 : 0,
      JSON.stringify(order.previousLineItems),
      JSON.stringify(order.nextLineItems),
      order.previousTotalCents,
      order.nextTotalCents,
      order.reason,
      order.createdAt,
      order.resolvedAt,
      order.resolvedBy,
    );
    return order;
  }

  listChangeOrders(jobId: string): ChangeOrder[] {
    return this.all(`SELECT * FROM change_orders WHERE job_id = ? ORDER BY created_at`, jobId).map(mapChangeOrder);
  }

  getChangeOrder(jobId: string, id: string): ChangeOrder | null {
    const row = this.get(`SELECT * FROM change_orders WHERE job_id = ? AND id = ?`, jobId, id);
    return row ? mapChangeOrder(row) : null;
  }

  resolveChangeOrder(jobId: string, id: string, status: ChangeOrder["status"], resolvedBy: string): void {
    this.run(
      `UPDATE change_orders SET status = ?, resolved_at = ?, resolved_by = ? WHERE job_id = ? AND id = ?`,
      status,
      this.stamp(),
      resolvedBy,
      jobId,
      id,
    );
  }

  insertAudit(jobId: string, actorName: string, action: string, detail: string): AuditEntry {
    const entry: AuditEntry = {
      id: this.id(),
      jobId,
      actorName,
      action,
      detail,
      createdAt: this.stamp(),
    };
    this.run(
      `INSERT INTO audit_log (id, job_id, actor_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.jobId,
      entry.actorName,
      entry.action,
      entry.detail,
      entry.createdAt,
    );
    return entry;
  }

  listAudit(jobId: string): AuditEntry[] {
    return this.all(`SELECT * FROM audit_log WHERE job_id = ? ORDER BY created_at`, jobId).map((row) => ({
      id: text(row, "id"),
      jobId: text(row, "job_id"),
      actorName: text(row, "actor_name"),
      action: text(row, "action"),
      detail: text(row, "detail"),
      createdAt: text(row, "created_at"),
    }));
  }

  private messageByKey(key: string): CustomerMessage | null {
    const row = this.get(`SELECT * FROM messages WHERE idempotency_key = ?`, key);
    return row ? mapMessage(row) : null;
  }

  private getMessage(id: string): CustomerMessage | null {
    const row = this.get(`SELECT * FROM messages WHERE id = ?`, id);
    return row ? mapMessage(row) : null;
  }

  private insertMessage(message: CustomerMessage): void {
    this.run(
      `INSERT INTO messages (
        id, job_id, customer_id, direction, channel, body, subject, status, idempotency_key,
        ghl_message_id, ghl_conversation_id, trigger_key, detail, send_after, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      message.id,
      message.jobId,
      message.customerId,
      message.direction,
      message.channel,
      message.body,
      message.subject,
      message.status,
      message.idempotencyKey,
      message.ghlMessageId,
      message.ghlConversationId,
      message.trigger,
      message.detail,
      message.sendAfter,
      message.createdAt,
    );
  }
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Expected text in ${key}`);
  return value;
}

function textOrNull(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Expected text in ${key}`);
  return value;
}

function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Expected number in ${key}`);
}

function integerOrNull(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return integer(row, key);
}

function flag(row: Row, key: string): boolean {
  return integer(row, key) !== 0;
}

function mapCustomer(row: Row): Customer {
  return {
    id: text(row, "id"),
    firstName: text(row, "first_name"),
    lastName: text(row, "last_name"),
    phone: text(row, "phone"),
    email: textOrNull(row, "email"),
    ghlContactId: textOrNull(row, "ghl_contact_id"),
    stripeCustomerId: textOrNull(row, "stripe_customer_id"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function mapAddress(row: Row): Address {
  return {
    id: text(row, "id"),
    customerId: text(row, "customer_id"),
    line1: text(row, "line1"),
    line2: textOrNull(row, "line2"),
    city: text(row, "city"),
    state: text(row, "state"),
    postalCode: text(row, "postal_code"),
    lat: integerOrNull(row, "lat"),
    lng: integerOrNull(row, "lng"),
    addressKey: text(row, "address_key"),
  };
}

function mapTechnician(row: Row): Technician {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    phone: textOrNull(row, "phone"),
    active: flag(row, "active"),
    createdAt: text(row, "created_at"),
  };
}

function lineItems(json: string): LineItem[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item.description !== "string" || typeof item.amountCents !== "number") return [];
    return [{ description: item.description, amountCents: item.amountCents }];
  });
}

function mapEstimate(row: Row): Estimate {
  const rawStatus = text(row, "status");
  const status = rawStatus === "accepted" || rawStatus === "declined" ? rawStatus : "draft";
  return {
    id: text(row, "id"),
    customerId: text(row, "customer_id"),
    addressId: text(row, "address_id"),
    status,
    serviceCents: integer(row, "service_cents"),
    travelFeeCents: integer(row, "travel_fee_cents"),
    totalCents: integer(row, "total_cents"),
    driveMinutes: integerOrNull(row, "drive_minutes"),
    travelBasis: text(row, "travel_basis"),
    travelReviewRequired: flag(row, "travel_review_required"),
    priceLocked: flag(row, "price_locked"),
    lockedFromEstimateId: textOrNull(row, "locked_from_estimate_id"),
    lineItems: lineItems(text(row, "line_items_json")),
    acceptedAt: textOrNull(row, "accepted_at"),
    createdAt: text(row, "created_at"),
  };
}

function mapJob(row: Row): Job {
  return {
    id: text(row, "id"),
    customerId: text(row, "customer_id"),
    addressId: text(row, "address_id"),
    estimateId: textOrNull(row, "estimate_id"),
    title: text(row, "title"),
    scheduledStart: text(row, "scheduled_start"),
    scheduledEnd: text(row, "scheduled_end"),
    status: text(row, "status") as JobStatus,
    priceLocked: flag(row, "price_locked"),
    serviceCents: integer(row, "service_cents"),
    travelFeeCents: integer(row, "travel_fee_cents"),
    totalCents: integer(row, "total_cents"),
    lineItems: lineItems(text(row, "line_items_json")),
    postWalkthroughComplete: flag(row, "post_walkthrough"),
    ghlOpportunityId: textOrNull(row, "ghl_opportunity_id"),
    ghlAppointmentId: textOrNull(row, "ghl_appointment_id"),
    unscheduled: flag(row, "unscheduled"),
    arrivalStart: textOrNull(row, "arrival_start"),
    arrivalEnd: textOrNull(row, "arrival_end"),
    accessNotes: textOrNull(row, "access_notes"),
    shareToken: textOrNull(row, "share_token"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function mapNote(row: Row): JobNote {
  return {
    id: text(row, "id"),
    jobId: text(row, "job_id"),
    authorName: text(row, "author_name"),
    body: text(row, "body"),
    visibility: "internal",
    createdAt: text(row, "created_at"),
  };
}

function mapMessage(row: Row): CustomerMessage {
  const direction = text(row, "direction") === "inbound" ? "inbound" : "outbound";
  const channel = text(row, "channel") === "email" ? "email" : "sms";
  const rawStatus = text(row, "status");
  const status =
    rawStatus === "sent" ||
    rawStatus === "failed" ||
    rawStatus === "skipped" ||
    rawStatus === "sending" ||
    rawStatus === "held"
      ? rawStatus
      : "failed";
  return {
    id: text(row, "id"),
    jobId: text(row, "job_id"),
    customerId: text(row, "customer_id"),
    direction,
    channel,
    body: text(row, "body"),
    subject: textOrNull(row, "subject"),
    status,
    idempotencyKey: text(row, "idempotency_key"),
    ghlMessageId: textOrNull(row, "ghl_message_id"),
    ghlConversationId: textOrNull(row, "ghl_conversation_id"),
    trigger: text(row, "trigger_key"),
    detail: textOrNull(row, "detail"),
    sendAfter: textOrNull(row, "send_after"),
    createdAt: text(row, "created_at"),
  };
}

function sundaySkip(message: CustomerMessage): boolean {
  return message.status === "skipped" && message.detail === "sunday_not_useful";
}

function mapChangeOrder(row: Row): ChangeOrder {
  const raw = text(row, "status");
  const status = raw === "pending" || raw === "approved" || raw === "rejected" || raw === "applied" ? raw : "pending";
  return {
    id: text(row, "id"),
    jobId: text(row, "job_id"),
    authorName: text(row, "author_name"),
    status,
    customerApproved: flag(row, "customer_approved"),
    previousLineItems: lineItems(text(row, "previous_json")),
    nextLineItems: lineItems(text(row, "next_json")),
    previousTotalCents: integer(row, "previous_total_cents"),
    nextTotalCents: integer(row, "next_total_cents"),
    reason: text(row, "reason"),
    createdAt: text(row, "created_at"),
    resolvedAt: textOrNull(row, "resolved_at"),
    resolvedBy: textOrNull(row, "resolved_by"),
  };
}

function mapInvoice(row: Row): Invoice {
  return {
    id: text(row, "id"),
    jobId: text(row, "job_id"),
    customerId: text(row, "customer_id"),
    number: text(row, "number"),
    totalCents: integer(row, "total_cents"),
    serviceCents: integer(row, "service_cents"),
    travelFeeCents: integer(row, "travel_fee_cents"),
    status: text(row, "status") as Invoice["status"],
    lineItems: lineItems(text(row, "line_items_json")),
    issuedAt: textOrNull(row, "issued_at"),
    createdAt: text(row, "created_at"),
  };
}

function mapPayment(row: Row): Payment {
  return {
    id: text(row, "id"),
    invoiceId: text(row, "invoice_id"),
    jobId: text(row, "job_id"),
    amountCents: integer(row, "amount_cents"),
    status: text(row, "status") as Payment["status"],
    provider: text(row, "provider"),
    providerRef: textOrNull(row, "provider_ref"),
    blockedReason: textOrNull(row, "blocked_reason"),
    createdAt: text(row, "created_at"),
  };
}
