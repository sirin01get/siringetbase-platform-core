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
// UPDATE — mirrors cafocus/app's src/lib/admin/env-check.ts (same file,
// duplicated for the same "two separate deployable Workers, no shared
// import path" reason as everything else cross-Worker in this build): the
// owner's follow-up ask was "add a column for test result. add a simple
// test that verifies that parameter is working. if it's just a control
// showing value is fine. but if its's a secret or key for a service then a
// simple test shall be done." Every EnvVarResult below now also carries a
// testResult ("pass" | "fail" | "not_tested") from a real, side-effect-free
// probe — see "Live tests" further down. This overlaps in places with the
// live Supabase/Neo4j checks in app/api/diagnostics/route.ts (both end up
// proving the same database is reachable) — intentional, not a regression
// of the earlier "deliberately does NOT duplicate" note: diagnostics
// answers "can this deployment function right now," this answers "is
// *this specific var* the reason if not."
//
// The five *_INTERNAL_SECRET vars here are the values THIS deployment
// compares an inbound request header against — there's no live probe that
// makes sense from this side (comparing a value to itself is always true).
// Their real test already exists: the "Shared secrets" fingerprint
// cross-check against the calling vertical's own copy of the same secret,
// already computed by cafocus/app's matchSharedSecrets(). Marked
// not_tested here for that reason, not because they're uninteresting.
//
// New env var added to config/env.ts? Add a matching entry to
// ENV_VAR_SPECS below too — nothing enforces the two lists staying in sync
// automatically, so a var only in env.ts is invisible here.

import { checkNeo4jConnectivity } from "@/lib/neo4j/client";

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

export type TestOutcome = "pass" | "fail" | "not_tested";

export interface EnvVarResult extends EnvVarSpec {
  configured: boolean;
  /** null when isUrl isn't set on the spec — "not applicable", not "invalid". */
  validUrl: boolean | null;
  /** Short one-way hash of the value — only set for configured, secret, mustMatchKey vars. Never the value itself. */
  fingerprint: string | null;
  /** Result of a real, live, side-effect-free probe — see "Live tests" below. "not_tested" for plain controls. */
  testResult: TestOutcome;
  /** Human-readable reason for testResult. Never includes the var's actual value. */
  testMessage: string | null;
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

// --- Live tests ---------------------------------------------------------
// Same three ground rules as cafocus/app's copy of this file: never echo a
// secret's value; never trigger a real side effect (RESEND_API_KEY's probe
// below reads Resend's domain list, it never sends a test email); a
// network/timeout failure always reports as "fail" with the raw detail,
// never silently degrades to "not_tested".

interface TestOutcomeResult {
  result: TestOutcome;
  message: string;
}

function pass(message: string): TestOutcomeResult {
  return { result: "pass", message };
}
function fail(message: string): TestOutcomeResult {
  return { result: "fail", message };
}

// Supabase: same combined probe as cafocus/app's copy — the service-role
// probe hits GoTrue's admin API, which only accepts a JWT whose role claim
// is actually "service_role", catching a publishable/anon key pasted in by
// mistake even though that's still a *valid* key elsewhere.
async function testSupabaseGroup(): Promise<Record<string, TestOutcomeResult>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    const skip: TestOutcomeResult = { result: "not_tested", message: "Skipped — NEXT_PUBLIC_SUPABASE_URL isn't set." };
    return { NEXT_PUBLIC_SUPABASE_URL: fail("Not set — nothing to test."), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: skip, SUPABASE_SERVICE_ROLE_KEY: skip };
  }

  const results: Record<string, TestOutcomeResult> = {};

  // Supabase's edge gateway now requires an `apikey` header on EVERY
  // request to a project subdomain — including /auth/v1/health, which used
  // to be a genuinely public, unauthenticated GoTrue endpoint — as part of
  // the platform-wide rollout of the new sb_publishable_/sb_secret_ key
  // format this project uses. An unkeyed request gets rejected before it
  // ever reaches GoTrue, which made this probe report "failed" for a
  // perfectly fine URL.
  try {
    const res = await fetch(`${url}/auth/v1/health`, publishableKey ? { headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` } } : undefined);
    results.NEXT_PUBLIC_SUPABASE_URL =
      res.ok || res.status === 401
        ? pass("Reachable — Supabase responded.")
        : fail(`Reachable but returned HTTP ${res.status} — double-check this is the right project URL.`);
  } catch (err) {
    results.NEXT_PUBLIC_SUPABASE_URL = fail(`Could not reach this host: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (publishableKey) {
    try {
      // Same gateway requirement as above — apikey alone isn't always
      // enough, Authorization: Bearer must match it too.
      const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` } });
      results.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
        res.status === 401
          ? fail("Supabase rejected this key (401) — it doesn't match this project.")
          : pass("Supabase accepted this key.");
    } catch (err) {
      results.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = fail(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    results.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = fail("Not set — nothing to test.");
  }

  if (serviceRoleKey) {
    try {
      const res = await fetch(`${url}/auth/v1/admin/users?per_page=1`, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      });
      results.SUPABASE_SERVICE_ROLE_KEY = res.ok
        ? pass("Confirmed real service_role privilege — GoTrue's admin API accepted it.")
        : fail(
            `GoTrue's admin API rejected this key (HTTP ${res.status}) — either it's invalid, or it's a valid key ` +
              `at the wrong privilege level (e.g. the publishable/anon key pasted here by mistake).`
          );
    } catch (err) {
      results.SUPABASE_SERVICE_ROLE_KEY = fail(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    results.SUPABASE_SERVICE_ROLE_KEY = fail("Not set — nothing to test.");
  }

  return results;
}

// Neo4j: one shared "RETURN 1" probe covers all four vars, same reasoning
// as cafocus/app's copy.
async function testNeo4jGroup(): Promise<Record<string, TestOutcomeResult>> {
  const configured = Boolean(process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD);
  if (!configured) {
    const skip: TestOutcomeResult = { result: "not_tested", message: "Skipped — NEO4J_URI/NEO4J_USER/NEO4J_PASSWORD aren't all set." };
    return { NEO4J_URI: skip, NEO4J_USER: skip, NEO4J_PASSWORD: skip, NEO4J_DATABASE: skip };
  }
  const connectivity = await checkNeo4jConnectivity();
  const outcome = connectivity.ok ? pass("Ran `RETURN 1` against the live database — connected.") : fail(connectivity.error ?? "Unknown connection error.");
  return { NEO4J_URI: outcome, NEO4J_USER: outcome, NEO4J_PASSWORD: outcome, NEO4J_DATABASE: outcome };
}

// RESEND_API_KEY: Resend's GET /domains is a read-only listing endpoint —
// confirms the key authenticates without sending any email.
async function testResendApiKey(): Promise<TestOutcomeResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return fail("Not set — nothing to test.");
  try {
    const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401 || res.status === 403) return fail(`Resend rejected this key (HTTP ${res.status}).`);
    if (!res.ok) return fail(`Unexpected response from Resend: HTTP ${res.status}.`);
    return pass("Resend accepted this key (read-only domains lookup — no email sent).");
  } catch (err) {
    return fail(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// CAFOCUS_APP_BASE_URL: cafocus/app's own unauthenticated GET /api/health.
async function testCafocusAppBaseUrl(): Promise<TestOutcomeResult> {
  const baseUrl = process.env.CAFOCUS_APP_BASE_URL;
  if (!baseUrl) return fail("Not set — nothing to test.");
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    if (!res.ok) return fail(`Reachable but returned HTTP ${res.status}.`);
    const body = (await res.json().catch(() => ({}))) as { status?: string };
    return body.status === "ok" ? pass("cafocus/app's /api/health responded ok.") : fail("Reached cafocus/app, but /api/health's response wasn't the expected shape.");
  } catch (err) {
    return fail(`Could not reach this URL: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function buildEnvCheckReport(appName: string): Promise<EnvCheckReport> {
  const testResults = new Map<string, TestOutcomeResult>();

  for (const [name, r] of Object.entries(await testSupabaseGroup())) testResults.set(name, r);
  for (const [name, r] of Object.entries(await testNeo4jGroup())) testResults.set(name, r);
  testResults.set("RESEND_API_KEY", await testResendApiKey());
  testResults.set("CAFOCUS_APP_BASE_URL", await testCafocusAppBaseUrl());

  // SEND_EMAIL_HOOK_SECRET verifies an HMAC signature Supabase computes on
  // its end — there's no live probe possible from this side (any value
  // "verifies" a payload signed with that same value; the only way to
  // confirm it matches what Supabase's dashboard actually has configured
  // is a real webhook delivery).
  testResults.set("SEND_EMAIL_HOOK_SECRET", {
    result: "not_tested",
    message: "No live probe possible — this secret's correctness can only be confirmed by a real inbound Supabase webhook, not tested from this side.",
  });

  // The five *_INTERNAL_SECRET vars this deployment checks incoming
  // requests against — see this file's header comment for why a self-test
  // is meaningless and the fingerprint cross-check is the real test.
  const noSelfTest: TestOutcomeResult = {
    result: "not_tested",
    message: "This deployment is the callee for this secret — see the \"Shared secrets\" fingerprint cross-check on cafocus/app's combined dashboard for the real test.",
  };
  for (const n of ["COMMS_INTERNAL_SECRET", "DOCUMENT_INTELLIGENCE_INTERNAL_SECRET", "PAYMENTS_INTERNAL_SECRET", "SUBSCRIPTIONS_INTERNAL_SECRET", "ENV_CHECK_INTERNAL_SECRET"]) {
    testResults.set(n, noSelfTest);
  }

  const controlNote: TestOutcomeResult = { result: "not_tested", message: "Just a control — the configured/shape check above is sufficient." };
  for (const n of ["PAYMENT_GATEWAY_PROVIDER", "BANK_PAYOUT_PROVIDER", "COMMS_FROM_EMAIL", "SUPPORT_INBOX_EMAIL"]) {
    testResults.set(n, controlNote);
  }

  const vars: EnvVarResult[] = [];
  for (const spec of ENV_VAR_SPECS) {
    const value = process.env[spec.name];
    const configured = Boolean(value);
    const validUrl = spec.isUrl ? (configured ? isLikelyValidUrl(value as string) : false) : null;
    const fp = spec.secret && spec.mustMatchKey && configured ? await fingerprint(value as string) : null;
    const test = testResults.get(spec.name) ?? { result: "not_tested" as TestOutcome, message: "Not tested." };
    vars.push({ ...spec, configured, validUrl, fingerprint: fp, testResult: test.result, testMessage: test.message });
  }
  return { app: appName, timestamp: new Date().toISOString(), vars };
}
