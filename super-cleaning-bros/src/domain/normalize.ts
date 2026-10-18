const STREET_SUFFIXES: Record<string, string> = {
  st: "street",
  street: "street",
  ave: "avenue",
  avenue: "avenue",
  rd: "road",
  road: "road",
  dr: "drive",
  drive: "drive",
  ln: "lane",
  lane: "lane",
  blvd: "boulevard",
  boulevard: "boulevard",
  ct: "court",
  court: "court",
  cir: "circle",
  circle: "circle",
  pkwy: "parkway",
  parkway: "parkway",
  way: "way",
  pl: "place",
  place: "place",
};

export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function formatPhone(phone: string): string {
  if (phone.length !== 10) return phone;
  return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
}

/** Matching key only. Punctuation is removed so O'Brien and Obrien compare equal. */
export function normalizeMatchName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function displayName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function addressKey(parts: {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
}): string {
  const raw = [parts.line1, parts.line2, parts.city, parts.state, parts.postalCode]
    .filter((part) => part && part.trim())
    .join(" ")
    .toLowerCase()
    .replace(/[#.,]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return raw
    .split(/\s+/)
    .map((token) => STREET_SUFFIXES[token] ?? token)
    .join(" ");
}

export function postalDigits(postalCode: string): string {
  const match = postalCode.match(/\d{5}/);
  return match?.[0] ?? "";
}
