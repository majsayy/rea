export const TEMPLATE_KEYS = ["on_my_way", "started", "finished", "review", "reschedule", "photos"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type TemplateDraft = {
  key: TemplateKey;
  channel: "sms" | "email";
  subject: string | null;
  body: string;
};

export const DEFAULT_TEMPLATES: readonly TemplateDraft[] = [
  {
    key: "on_my_way",
    channel: "sms",
    subject: null,
    body: "Hi {{customerFirst}}, {{techName}} from Super Cleaning Bros is on the way to {{address}}. ETA {{eta}}.",
  },
  {
    key: "started",
    channel: "sms",
    subject: null,
    body: "Hi {{customerFirst}}, we started your job at {{address}}.",
  },
  {
    key: "finished",
    channel: "sms",
    subject: null,
    body: "Hi {{customerFirst}}, we finished your job at {{address}}. Thank you for choosing Super Cleaning Bros.",
  },
  {
    key: "review",
    channel: "sms",
    subject: null,
    body: "Hi {{customerFirst}}, if you have a minute, we'd love a review: {{reviewUrl}}",
  },
  {
    key: "reschedule",
    channel: "sms",
    subject: null,
    body: "Hi {{customerFirst}}, your Super Cleaning Bros visit was moved to {{when}}.",
  },
  {
    key: "photos",
    channel: "email",
    subject: "Your Super Cleaning Bros photos",
    body: "Hi {{customerFirst}}, your before and after photos from Super Cleaning Bros are ready: {{photoUrl}}",
  },
];

export function isTemplateKey(value: string): value is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g, (_match, key: string) => vars[key] ?? "");
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
