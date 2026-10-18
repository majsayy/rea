import { AppError } from "./errors.ts";

export const TEMPLATE_KEYS = ["on_my_way", "started", "finished", "review", "reschedule", "photos"] as const;
export const EM_DASH = "\u2014";
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
    body: "Hi {{customerFirst}}, it's {{techName}} with Super Cleaning Bros. I'm on my way to {{address}} and should be there {{eta}}.",
  },
  {
    key: "started",
    channel: "sms",
    subject: null,
    body: "Hi {{customerFirst}}, we just started at {{address}}.",
  },
  {
    key: "finished",
    channel: "sms",
    subject: null,
    body: "Hi {{customerFirst}}, we're all finished at {{address}}. Thanks for having Super Cleaning Bros out.",
  },
  {
    key: "review",
    channel: "sms",
    subject: null,
    body: "Hi {{customerFirst}}, if you have a minute we'd really appreciate a review: {{reviewUrl}}",
  },
  {
    key: "reschedule",
    channel: "sms",
    subject: null,
    body: "Hi {{customerFirst}}, your Super Cleaning Bros visit is now {{when}}.",
  },
  {
    key: "photos",
    channel: "email",
    subject: "Photos from your cleaning",
    body: "Hi {{customerFirst}}, here are the before and after photos from your visit: {{photoUrl}}",
  },
];

export function assertNoEmDash(value: string, label: string): void {
  if (value.includes(EM_DASH)) {
    throw new AppError("invalid_template", `${label} cannot use an em dash. Write it the way you'd text someone.`, 400);
  }
}

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
