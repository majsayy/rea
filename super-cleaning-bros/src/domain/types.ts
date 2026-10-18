export type JobStatus = "scheduled" | "on_my_way" | "in_progress" | "done";
export type EstimateStatus = "draft" | "accepted" | "declined";
export type InvoiceStatus = "draft" | "issued" | "paid" | "void";
export type PaymentStatus = "succeeded" | "failed" | "blocked";
export type PhotoKind = "before" | "after" | "walkthrough";

export type LineItem = {
  description: string;
  amountCents: number;
};

export type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  ghlContactId: string | null;
  stripeCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Address = {
  id: string;
  customerId: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
  addressKey: string;
};

export type Technician = {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
  createdAt: string;
};

export type Estimate = {
  id: string;
  customerId: string;
  addressId: string;
  status: EstimateStatus;
  serviceCents: number;
  travelFeeCents: number;
  totalCents: number;
  driveMinutes: number | null;
  travelBasis: string;
  travelReviewRequired: boolean;
  priceLocked: boolean;
  lockedFromEstimateId: string | null;
  lineItems: LineItem[];
  acceptedAt: string | null;
  createdAt: string;
};

export type Job = {
  id: string;
  customerId: string;
  addressId: string;
  estimateId: string | null;
  title: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: JobStatus;
  priceLocked: boolean;
  serviceCents: number;
  travelFeeCents: number;
  totalCents: number;
  lineItems: LineItem[];
  postWalkthroughComplete: boolean;
  ghlOpportunityId: string | null;
  ghlAppointmentId: string | null;
  unscheduled: boolean;
  arrivalStart: string | null;
  arrivalEnd: string | null;
  accessNotes: string | null;
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobNote = {
  id: string;
  jobId: string;
  authorName: string;
  body: string;
  visibility: "internal";
  createdAt: string;
};

export type CustomerMessage = {
  id: string;
  jobId: string;
  customerId: string;
  direction: "outbound" | "inbound";
  channel: "sms" | "email";
  body: string;
  subject: string | null;
  status: "sending" | "sent" | "failed" | "skipped" | "held";
  idempotencyKey: string;
  ghlMessageId: string | null;
  ghlConversationId: string | null;
  trigger: string;
  detail: string | null;
  sendAfter: string | null;
  createdAt: string;
};

export type MessageTemplate = {
  key: string;
  channel: "sms" | "email";
  subject: string | null;
  body: string;
  updatedAt: string;
};

export type ChangeOrderStatus = "pending" | "approved" | "rejected" | "applied";

export type ChangeOrder = {
  id: string;
  jobId: string;
  authorName: string;
  status: ChangeOrderStatus;
  customerApproved: boolean;
  previousLineItems: LineItem[];
  nextLineItems: LineItem[];
  previousTotalCents: number;
  nextTotalCents: number;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

export type AuditEntry = {
  id: string;
  jobId: string;
  actorName: string;
  action: string;
  detail: string;
  createdAt: string;
};

export type PhotoMeta = {
  id: string;
  jobId: string;
  kind: PhotoKind;
  contentType: string;
  byteLength: number;
  createdAt: string;
};

export type CardOnFile = {
  customerId: string;
  provider: string;
  providerCustomerId: string;
  providerPaymentMethodId: string;
  brand: string | null;
  last4: string | null;
  updatedAt: string;
};

export type Invoice = {
  id: string;
  jobId: string;
  customerId: string;
  number: string;
  totalCents: number;
  serviceCents: number;
  travelFeeCents: number;
  status: InvoiceStatus;
  lineItems: LineItem[];
  issuedAt: string | null;
  createdAt: string;
};

export type Payment = {
  id: string;
  invoiceId: string;
  jobId: string;
  amountCents: number;
  status: PaymentStatus;
  provider: string;
  providerRef: string | null;
  blockedReason: string | null;
  createdAt: string;
};

export type SyncState =
  | { state: "sent" }
  | { state: "skipped"; reason: string }
  | { state: "failed"; detail: string };
