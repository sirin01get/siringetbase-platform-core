// Phase 2 item from ../../../document-intelligence/PERFORMANCE_STRATEGY.md:
// "field-level validation on top of the heuristic confidence score." This
// module is deliberately independent of extract.ts's presence-based
// scoreExtraction() (Phase 1 territory) — it answers a different question.
// Presence only knows whether a required field has SOME non-empty value;
// it can't tell "seller_gstin": "22AAAAA0000A1Z5" (right shape, correct
// checksum) from "seller_gstin": "22AAAAA0000A1Z4" (one misread character,
// still non-empty, still "present"). Cheap regex/checksum checks on the
// handful of Indian tax identifiers and dates that already show up across
// every extraction_templates schema (0021/0028/0029_*.sql) catch that
// second case. Called from scoreExtraction() and combined additively with
// the presence score there, never as a replacement — see that function's
// comment for how the two are combined.
//
// Every validator here is pure and synchronous (no I/O, no network) — the
// classifier walks the already-parsed model output plus the template's own
// output_schema (both already in memory by the time scoreExtraction() runs),
// so this whole module costs microseconds per document and adds nothing to
// either the user-facing upload request (which never awaits extraction —
// see cafocus/app's src/lib/document-intelligence/trigger.ts) or any new
// network round trip.

export type FieldKind = "gstin" | "pan" | "tan" | "date";

export interface FieldValidationIssue {
  // Dotted/bracketed path into the parsed object, e.g.
  // "short_term_transactions[2].buy_date" — enough for a reviewer (or the
  // raw_output JSON a business_admin/CA already reads today) to find the
  // exact field without a schema in hand.
  path: string;
  kind: FieldKind;
  value: string;
  reason: string;
}

// --- Field-name classification -------------------------------------------
//
// There's no per-field "semantic type" carried in output_schema (it's plain
// JSON Schema — {"type": "string"} either way), so this classifies by
// field NAME against the actual property names used across every seeded
// template (0021/0028/0029_*.sql + the AIS/capital-gains ones): pan,
// employee_pan, employer_tan, deductor_tan, seller_gstin, buyer_gstin,
// invoice_date, buy_date, sell_date, statement_period_start/end, and the
// per-transaction "date" field on bank_statement. Deliberately name-based
// rather than an allowlist of exact field names, so a template edited later
// via the admin UI (src/lib/document-intelligence/templates.ts) picks up
// validation automatically as long as it follows the same naming
// convention the existing eight templates already use.
export function classifyFieldKind(fieldName: string): FieldKind | null {
  const name = fieldName.toLowerCase();
  if (name.includes("gstin")) return "gstin";
  if (name === "pan" || name.endsWith("_pan")) return "pan";
  if (name === "tan" || name.endsWith("_tan")) return "tan";
  if (name.includes("date")) return "date";
  // statement_period_start / statement_period_end (0028) don't contain
  // "date" but are dates — caught here instead of broadening the "date"
  // substring check into something that'd false-positive on unrelated
  // "_start"/"_end" fields a future template might add for a non-date range.
  if (name.includes("period") && (name.endsWith("_start") || name.endsWith("_end"))) return "date";
  return null;
}

// --- GSTIN -----------------------------------------------------------------
//
// Format: 2-digit state code + 10-character PAN + 1 entity/registration
// number (1-9 or A-Z) + literal 'Z' + 1 checksum character. Unlike PAN/TAN
// below, GSTIN's checksum algorithm IS publicly documented — the standard
// mod-36 "Code 39" style check digit used by every open-source GSTIN
// validator (e.g. https://github.com/tk120404/gst). Verified against known
// real GSTINs before wiring this in (see task #508's fixture spot-check).

const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHECKSUM_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function gstinChecksumChar(gstinFirst14: string): string | null {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const factor = i % 2 === 0 ? 1 : 2;
    // .charAt() (unlike bracket indexing) is typed to always return
    // `string`, never `string | undefined` — sidesteps
    // noUncheckedIndexedAccess without an unnecessary runtime guard, since
    // i is already bounded 0..13 by the loop.
    const code = GSTIN_CHECKSUM_ALPHABET.indexOf(gstinFirst14.charAt(i));
    if (code === -1) return null;
    const product = code * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const checksumIndex = (36 - (sum % 36)) % 36;
  return GSTIN_CHECKSUM_ALPHABET.charAt(checksumIndex);
}

export function validateGSTIN(raw: string): { valid: boolean; reason?: string } {
  const value = raw.trim().toUpperCase();
  if (!GSTIN_FORMAT.test(value)) {
    return {
      valid: false,
      reason:
        "Doesn't match the 15-character GSTIN format (2-digit state code + 10-character PAN + entity code + 'Z' + checksum).",
    };
  }
  const expected = gstinChecksumChar(value.slice(0, 14));
  const actual = value.charAt(14);
  if (expected !== null && expected !== actual) {
    return { valid: false, reason: `Fails the GSTIN checksum digit — expected "${expected}", got "${actual}". Likely a misread character.` };
  }
  return { valid: true };
}

// --- PAN / TAN --------------------------------------------------------------
//
// Format only, deliberately NOT a checksum, despite the surface similarity
// to GSTIN (whose first 10 characters ARE a PAN). Confirmed via web search
// before implementing this: the Income Tax Department has never published
// the algorithm behind PAN/TAN's trailing check character the way GSTIN's
// mod-36 digit is documented — every validator that claims to "check" a PAN
// checksum online is actually only checking the AAAAA9999A shape. Claiming
// otherwise here would be a false confidence signal, worse than not
// checking at all, so this stays a format check.

const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const TAN_FORMAT = /^[A-Z]{4}[0-9]{5}[A-Z]$/;

export function validatePAN(raw: string): { valid: boolean; reason?: string } {
  const value = raw.trim().toUpperCase();
  if (!PAN_FORMAT.test(value)) {
    return { valid: false, reason: 'Doesn\'t match the PAN format (5 letters + 4 digits + 1 letter, e.g. "ABCDE1234F").' };
  }
  return { valid: true };
}

export function validateTAN(raw: string): { valid: boolean; reason?: string } {
  const value = raw.trim().toUpperCase();
  if (!TAN_FORMAT.test(value)) {
    return { valid: false, reason: 'Doesn\'t match the TAN format (4 letters + 5 digits + 1 letter, e.g. "ABCD12345E").' };
  }
  return { valid: true };
}

// --- Dates -------------------------------------------------------------
//
// The model is never told a specific output format for date fields (the
// prompts just say "extract the invoice date" etc.), and real source
// documents vary (DD-MM-YYYY on GST invoices, "DD Mon YYYY" on some Form 16s,
// ISO-ish YYYY-MM-DD from a broker export). So this validates "is this
// string a real calendar date in one of the shapes this pipeline's
// documents actually use" rather than enforcing one fixed format — still
// catches the case the heuristic can't: a present but garbled/impossible
// date like "31/02/2024" or "13/13/2024".

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

interface ParsedDate {
  d: number;
  mo: number;
  y: number;
}

// Every parse() below destructures capture groups then explicitly guards
// each one for undefined before use — RegExpMatchArray indexing is
// `string | undefined` under this project's noUncheckedIndexedAccess
// tsconfig even though these groups are non-optional in the regex itself
// (TS can't see that from the type alone). The guards double as the
// "malformed match" bailout (falls through to the next pattern, or to the
// final "doesn't match a recognized format" reason) they'd need anyway.
const DATE_PATTERNS: { regex: RegExp; parse: (m: RegExpMatchArray) => ParsedDate | null }[] = [
  // DD-MM-YYYY or DD/MM/YYYY
  {
    regex: /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/,
    parse: (m) => {
      const [, dd, mm, yyyy] = m;
      if (!dd || !mm || !yyyy) return null;
      return { d: +dd, mo: +mm, y: +yyyy };
    },
  },
  // YYYY-MM-DD or YYYY/MM/DD
  {
    regex: /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/,
    parse: (m) => {
      const [, yyyy, mm, dd] = m;
      if (!yyyy || !mm || !dd) return null;
      return { d: +dd, mo: +mm, y: +yyyy };
    },
  },
  // 1 Apr 2024 / 01-Apr-2024
  {
    regex: /^(\d{1,2})[\s-](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-](\d{4})$/i,
    parse: (m) => {
      const [, dd, monName, yyyy] = m;
      if (!dd || !monName || !yyyy) return null;
      const mo = MONTH_INDEX[monName.toLowerCase()];
      return mo ? { d: +dd, mo, y: +yyyy } : null;
    },
  },
  // Apr 1, 2024 / April 1 2024
  {
    regex: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/i,
    parse: (m) => {
      const [, monName, dd, yyyy] = m;
      if (!monName || !dd || !yyyy) return null;
      const mo = MONTH_INDEX[monName.toLowerCase()];
      return mo ? { d: +dd, mo, y: +yyyy } : null;
    },
  },
];

function isRealCalendarDate({ d, mo, y }: ParsedDate): boolean {
  // 1900-2100 is generous on purpose — this only needs to reject garbage
  // (OCR noise, placeholder years), not enforce a "documents can't predate
  // 2017 GST rollout" business rule that belongs elsewhere, not in a
  // generic date-shape validator.
  if (y < 1900 || y > 2100) return false;
  if (mo < 1 || mo > 12) return false;
  const daysInMonth = new Date(y, mo, 0).getDate();
  return d >= 1 && d <= daysInMonth;
}

export function validateDateField(raw: string): { valid: boolean; reason?: string } {
  const value = raw.trim();
  for (const pattern of DATE_PATTERNS) {
    const match = value.match(pattern.regex);
    if (!match) continue;
    const parsed = pattern.parse(match);
    if (!parsed) continue;
    if (isRealCalendarDate(parsed)) return { valid: true };
    return { valid: false, reason: `"${raw}" looks date-shaped but isn't a real calendar date.` };
  }
  return {
    valid: false,
    reason: `"${raw}" doesn't match a recognized date format (expected e.g. DD-MM-YYYY, YYYY-MM-DD, or "1 Apr 2024").`,
  };
}

function runValidator(kind: FieldKind, value: string): { valid: boolean; reason?: string } {
  switch (kind) {
    case "gstin":
      return validateGSTIN(value);
    case "pan":
      return validatePAN(value);
    case "tan":
      return validateTAN(value);
    case "date":
      return validateDateField(value);
  }
}

// --- Schema walk -------------------------------------------------------
//
// Recurses through output_schema's "type": "object" / "properties" and
// "type": "array" / "items" shapes (every template — 0021/0028/0029_*.sql —
// is built from exactly those two constructs, flat or one level of array
// nesting for line items like tds_entries/transactions) alongside the
// matching parsed data, so nested fields like
// "short_term_transactions[2].buy_date" get validated exactly like a
// top-level one.
//
// Only validates fields that are present and non-empty — missing-field
// detection is scoreExtraction()'s job (the required[] presence check);
// this only ever adds issues on TOP of that, never duplicates it.

function walkField(
  fieldName: string,
  fieldSchema: unknown,
  value: unknown,
  path: string,
  issues: FieldValidationIssue[]
): void {
  const schema = fieldSchema && typeof fieldSchema === "object" ? (fieldSchema as Record<string, unknown>) : {};

  if (schema.type === "array" && Array.isArray(value)) {
    value.forEach((item, i) => walkObject(schema.items, item, `${path}[${i}]`, issues));
    return;
  }
  if (schema.type === "object") {
    walkObject(schema, value, path, issues);
    return;
  }
  if (typeof value !== "string" || value.trim() === "") return;

  const kind = classifyFieldKind(fieldName);
  if (!kind) return;
  const result = runValidator(kind, value);
  if (!result.valid) {
    issues.push({ path, kind, value, reason: result.reason ?? "Failed validation." });
  }
}

function walkObject(schema: unknown, data: unknown, pathPrefix: string, issues: FieldValidationIssue[]): void {
  if (!schema || typeof schema !== "object" || !data || typeof data !== "object") return;
  const s = schema as Record<string, unknown>;
  if (!s.properties || typeof s.properties !== "object") return;
  const props = s.properties as Record<string, unknown>;
  const obj = data as Record<string, unknown>;
  for (const [key, subSchema] of Object.entries(props)) {
    const path = pathPrefix ? `${pathPrefix}.${key}` : key;
    walkField(key, subSchema, obj[key], path, issues);
  }
}

export function validateFields(parsed: unknown, outputSchema: Record<string, unknown>): FieldValidationIssue[] {
  const issues: FieldValidationIssue[] = [];
  walkObject(outputSchema, parsed, "", issues);
  return issues;
}
