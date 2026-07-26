// Presence + shape checks for every environment variable this deployment
// depends on (../../config/env.ts) — the owner's own ask, after
// PLATFORM_CORE_BASE_URL twice went missing on cafocus/app's Cloudflare
// Worker without anyone noticing until a specific feature broke: "create a
// separate dashboard for admin where all such variables are checked in the
// environment. list all such variables created in the program and there
// purposes. This report shall be usable in different environ as well as a
// kind of before go-live precheck."
//
// Never reads or echoes a secret's actual value — only whether it's set,
// whether it looks like a valid URL where a URL is expected, and (for the
// secrets that MUST be byte-identical to a same-keyed var on cafocus/app) a
// short one-way fingerprint, so a mismatch is visible on the combined
// dashboard without either deployment ever seeing the other's real value.
//
// Deliberately does NOT duplicate the live Supabase/Neo4j connectivity
// checks already in app/api/diagnostics/route.ts — this report answers "is
// every var configured and shaped right," that one answers "can we
// actually reach the database." The two are complementary, not redundant;
// app/admin/env-check/page.tsx links to both.
//
// New env var added to config/env.ts? Add a matching entry to
// ENV_VAR_SPECS below too — nothing enforces the two lists staying in sync
// automatically, so a var only in env.ts is invisible here.

export type EnvScope = "build" | "runtime";

export interface EnvVarSpec {
  name: string;
  scope: EnvScope;
  secret: boolean;
  purpose: string;
  /** Expect this var's value to look like a URL (parseable, non-empty scheme). */
  isUrl?: boolean;
  /**
   * Identifies a secret that must be byte-identical to a same-keyed var on
   * the OTHER deployment. The combined dashboard (built on cafocus/app's
   * side, since it's the one that already calls out to platform-core)
   * groups vars by this key and compares fingerprints across both reports.
   */
  mustMatchKey?: string;
}

export const ENV_VAR_SPECS: EnvVarSpec[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", scope: "build", secret: false, isUrl: true, purpose: "Shared Supabase project URL (siringetbase schema)." },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", scope: "build", secret: false, purpose: "Shared Supabase publishable API key." },
  { name: "SUPABASE_SERVICE_ROLE_KEY", scope: "runtime", secret: true, purpose: "Service-role key — cross-schema reads/writes, bypasses RLS." },
  { name: "NEO4J_URI", scope: "runtime", secret: true, isUrl: true, purpose: "Shared Neo4j Aura instance connection URI (entity graph)." },
  { name: "NEO4J_USER", scope: "runtime", secret: true, purpose: "Neo4j Aura username." },
  { name: "NEO4J_PASSWORD", scope: "runtime", secret: true, purpose: "Neo4j Aura password." },
  { name: "NEO4J_DATABASE", scope: "runtime", secret: false, purpose: "Neo4j database name inside the Aura instance. Optional — defaults to \"neo4j\"." },
  { name: "PAYMENT_GATEWAY_PROVIDER", scope: "runtime", secret: false, purpose: "Which mock payment-gateway adapter is active. Optional — defaults to razorpay-mock." },
  { name: "BANK_PAYOUT_PROVIDER", scope: "runtime", secret: false, purpose: "Which mock bank-payout adapter is active. Optional — defaults to icici-mock." },
  { name: "RESEND_API_KEY", scope: "runtime", secret: true, purpose: "Resend API key — sends every transactional/comms email." },
  { name: "SEND_EMAIL_HOOK_SECRET", scope: "runtime", secret: true, purpose: "Verifies Supabase Auth's Send Email webhook signature." },
  { name: "COMMS_FROM_EMAIL", scope: "runtime", secret: false, purpose: "From: address on every comms email. Optional — has a default." },
  { name: "COMMS_INTERNAL_SECRET", scope: "runtime", secret: true, purpose: "Gates POST /api/comms/notify.", mustMatchKey: "comms_internal_secret" },
  { name: "SUPPORT_INBOX_EMAIL", scope: "runtime", secret: false, purpose: "Where support.error_report_filed notifications land. Optional — has a default." },
  { name: "DOCUMENT_INTELLIGENCE_INTERNAL_SECRET", scope: "runtime", secret: true, purpose: "Gates POST /api/document-intelligence/extract.", mustMatchKey: "document_intelligence_internal_secret" },
  { name: "PAYMENTS_INTERNAL_SECRET", scope: "runtime", secret: true, purpose: "Gates POST /api/payments/hold and /release.", mustMatchKey: "payments_internal_secret" },
  { name: "CAFOCUS_APP_BASE_URL", scope: "runtime", secret: true, isUrl: true, purpose: "cafocus/app's deployed URL — the daily subscription-billing cron's callback target." },
  { name: "SUBSCRIPTIONS_INTERNAL_SECRET", scope: "runtime", secret: true, purpose: "Gates the reverse-direction subscription-billing-cycle call.", mustMatchKey: "subscriptions_internal_secret" },
  { name: "ENV_CHECK_INTERNAL_SECRET", scope: "runtime", secret: true, purpose: "Gates GET /api/internal/env-check — lets cafocus/app's combined precheck dashboard read this report." },
];

export interface EnvVarResult extends EnvVarSpec {
  configured: boolean;
  /** null when isUrl isn't set on the spec — "not applicable", not "invalid". */
  validUrl: boolean | null;
  /** Short one-way hash of the value — only set for configured, secret, mustMatchKey vars. Never the value itself. */
  fingerprint: string | null;
}

export interface EnvCheckReport {
  app: string;
  timestamp: string;
  vars: EnvVarResult[];
}

// SHA-256 via Web Crypto (available in the Workers runtime, unlike Node's
// `crypto` module) — truncated to 4 bytes/8 hex chars. Not meant to be
// cryptographically unguessable on its own (8 hex chars is a small space);
// it only needs to make an accidental typo or stale copy visible as "these
// don't match," which any change in the input reliably produces.
async function fingerprint(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isLikelyValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    // Accept https: (every plain HTTP URL in this system) and neo4j(+s):
    // (NEO4J_URI's own scheme) — anything else parseable but not one of
    // these is still almost certainly a mistake (e.g. http:// where https://
    // was needed, or a bare host with no scheme at all, which new URL()
    // actually rejects outright and lands in the catch below anyway).
    return ["https:", "neo4j:", "neo4j+s:", "neo4j+ssc:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export async function buildEnvCheckReport(appName: string): Promise<EnvCheckReport> {
  const vars: EnvVarResult[] = [];
  for (const spec of ENV_VAR_SPECS) {
    const value = process.env[spec.name];
    const configured = Boolean(value);
    const validUrl = spec.isUrl ? (configured ? isLikelyValidUrl(value as string) : false) : null;
    const fp = spec.secret && spec.mustMatchKey && configured ? await fingerprint(value as string) : null;
    vars.push({ ...spec, configured, validUrl, fingerprint: fp });
  }
  return { app: appName, timestamp: new Date().toISOString(), vars };
}
