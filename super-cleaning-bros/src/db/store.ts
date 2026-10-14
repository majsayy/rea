import type { DatabaseSync } from "node:sqlite";

import type {
  Address,
  CardOnFile,
  Customer,
  Estimate,
  Invoice,
  Job,
  JobNote,
  JobStatus,
  LineItem,
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

  markEstimate(id: string, status: "accepted" | "declined" | "sent", acceptedAt: string | null): void {
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
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.run(
      `INSERT INTO jobs (
        id, customer_id, address_id, estimate_id, title, scheduled_start, scheduled_end, status,
        price_locked, service_cents, travel_fee_cents, total_cents, line_items_json, post_walkthrough,
        ghl_opportunity_id, ghl_appointment_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    },
  ): void {
    this.run(
      `UPDATE jobs
       SET title = ?, scheduled_start = ?, scheduled_end = ?, status = ?, post_walkthrough = ?, updated_at = ?
       WHERE id = ?`,
      input.title,
      input.scheduledStart,
      input.scheduledEnd,
      input.status,
      input.postWalkthroughComplete ? 1 : 0,
      this.stamp(),
      id,
    );
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
      `SELECT * FROM jobs WHERE scheduled_start >= ? AND scheduled_start < ? ORDER BY scheduled_start`,
      fromIso,
      toIso,
    ).map(mapJob);
  }

  insertNote(jobId: string, authorName: string, body: string): JobNote {
    const note: JobNote = {
      id: this.id(),
      jobId,
      authorName,
      body,
      createdAt: this.stamp(),
    };
    this.run(
      "INSERT INTO job_notes (id, job_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)",
      note.id,
      note.jobId,
      note.authorName,
      note.body,
      note.createdAt,
    );
    return note;
  }

  listNotes(jobId: string): JobNote[] {
    return this.all(
      "SELECT * FROM job_notes WHERE job_id = ? ORDER BY created_at",
      jobId,
    ).map((row) => ({
      id: text(row, "id"),
      jobId: text(row, "job_id"),
      authorName: text(row, "author_name"),
      body: text(row, "body"),
      createdAt: text(row, "created_at"),
    }));
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
  return {
    id: text(row, "id"),
    customerId: text(row, "customer_id"),
    addressId: text(row, "address_id"),
    status: text(row, "status") as Estimate["status"],
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
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
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
