import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(secret, salt, 32).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [algorithm, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(secret, salt, 32);
  const expected = Buffer.from(hash, "base64url");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function secretsMatch(provided: string | null, expected: string | null): boolean {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
