import type { DatabaseSync } from "node:sqlite";

export function migrate(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      ghl_contact_id TEXT,
      stripe_customer_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS customers_last_name ON customers(last_name);
    CREATE INDEX IF NOT EXISTS customers_phone ON customers(phone);
    CREATE UNIQUE INDEX IF NOT EXISTS customers_ghl
      ON customers(ghl_contact_id) WHERE ghl_contact_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS addresses (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      line1 TEXT NOT NULL,
      line2 TEXT,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      lat REAL,
      lng REAL,
      address_key TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS addresses_customer ON addresses(customer_id);

    CREATE TABLE IF NOT EXISTS technicians (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      pin_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS estimates (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      address_id TEXT NOT NULL REFERENCES addresses(id),
      status TEXT NOT NULL,
      service_cents INTEGER NOT NULL,
      travel_fee_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      drive_minutes REAL,
      travel_basis TEXT NOT NULL,
      travel_review_required INTEGER NOT NULL,
      price_locked INTEGER NOT NULL,
      locked_from_estimate_id TEXT,
      line_items_json TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      address_id TEXT NOT NULL REFERENCES addresses(id),
      estimate_id TEXT,
      title TEXT NOT NULL,
      scheduled_start TEXT NOT NULL,
      scheduled_end TEXT NOT NULL,
      status TEXT NOT NULL,
      price_locked INTEGER NOT NULL,
      service_cents INTEGER NOT NULL,
      travel_fee_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      line_items_json TEXT NOT NULL,
      post_walkthrough INTEGER NOT NULL DEFAULT 0,
      ghl_opportunity_id TEXT,
      ghl_appointment_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_appointment
      ON jobs(ghl_appointment_id) WHERE ghl_appointment_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_opportunity
      ON jobs(ghl_opportunity_id) WHERE ghl_opportunity_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS jobs_start ON jobs(scheduled_start);

    CREATE TABLE IF NOT EXISTS job_assignments (
      job_id TEXT NOT NULL REFERENCES jobs(id),
      technician_id TEXT NOT NULL REFERENCES technicians(id),
      PRIMARY KEY (job_id, technician_id)
    );

    CREATE TABLE IF NOT EXISTS job_notes (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      kind TEXT NOT NULL,
      content_type TEXT NOT NULL,
      bytes BLOB NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id),
      provider TEXT NOT NULL,
      provider_customer_id TEXT NOT NULL,
      provider_payment_method_id TEXT NOT NULL,
      brand TEXT,
      last4 TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      number TEXT NOT NULL UNIQUE,
      total_cents INTEGER NOT NULL,
      service_cents INTEGER NOT NULL,
      travel_fee_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      line_items_json TEXT NOT NULL,
      issued_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      job_id TEXT NOT NULL REFERENCES jobs(id),
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_ref TEXT,
      blocked_reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ghl_events (
      id TEXT PRIMARY KEY,
      direction TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_receipts (
      id TEXT PRIMARY KEY,
      received_at TEXT NOT NULL
    );
  `);
  addColumn(db, "ALTER TABLE jobs ADD COLUMN unscheduled INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "ALTER TABLE jobs ADD COLUMN arrival_start TEXT");
  addColumn(db, "ALTER TABLE jobs ADD COLUMN arrival_end TEXT");
  addColumn(db, "ALTER TABLE jobs ADD COLUMN access_notes TEXT");
  addColumn(db, "ALTER TABLE jobs ADD COLUMN share_token TEXT");
  addColumn(db, "ALTER TABLE job_notes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'internal'");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_share_token
      ON jobs(share_token) WHERE share_token IS NOT NULL;
    CREATE INDEX IF NOT EXISTS jobs_unscheduled ON jobs(unscheduled);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      direction TEXT NOT NULL,
      channel TEXT NOT NULL,
      body TEXT NOT NULL,
      subject TEXT,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      ghl_message_id TEXT,
      ghl_conversation_id TEXT,
      trigger_key TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_customer ON messages(customer_id, created_at);
    CREATE INDEX IF NOT EXISTS messages_job ON messages(job_id, created_at);

    CREATE TABLE IF NOT EXISTS message_templates (
      key TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      subject TEXT,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS change_orders (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      author_name TEXT NOT NULL,
      status TEXT NOT NULL,
      customer_approved INTEGER NOT NULL,
      previous_json TEXT NOT NULL,
      next_json TEXT NOT NULL,
      previous_total_cents INTEGER NOT NULL,
      next_total_cents INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by TEXT
    );
    CREATE INDEX IF NOT EXISTS change_orders_job ON change_orders(job_id, created_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_log_job ON audit_log(job_id, created_at);
  `);
  addColumn(db, "ALTER TABLE messages ADD COLUMN send_after TEXT");
  db.exec(`CREATE INDEX IF NOT EXISTS messages_held ON messages(status, send_after);`);
}

function addColumn(db: DatabaseSync, sql: string): void {
  try {
    db.exec(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("duplicate column")) return;
    throw error;
  }
}
