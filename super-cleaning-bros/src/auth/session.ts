import { createHmac, timingSafeEqual } from "node:crypto";

export type Session = {
  role: "office" | "technician";
  technicianId: string | null;
  name: string;
  exp: number;
};

export function sealSession(session: Session, secret: string): string {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function openSession(token: string, secret: string, nowMs: number): Session | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!isSession(parsed) || parsed.exp < nowMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.role === "office" || record.role === "technician") &&
    (record.technicianId === null || typeof record.technicianId === "string") &&
    typeof record.name === "string" &&
    typeof record.exp === "number"
  );
}

export function sessionCookie(token: string, secure: boolean, maxAgeSeconds: number): string {
  const parts = [
    `scb_session=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const parts = ["scb_session=", "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}
