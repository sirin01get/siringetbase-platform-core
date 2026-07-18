// Typed access to environment variables — a missing var fails loudly at the
// call site instead of silently as `undefined` deep in a request. Values
// themselves are Tier 1 secrets (../../security/README.md) and live only in
// Cloudflare Workers Secrets / .env.local — never in this file, never in
// wrangler.jsonc's committed "vars" block for anything sensitive.

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env.local and fill it in.`
    );
  }
  return value;
}

export const env = {
  // Supabase — Postgres system of record for identity + payments
  // (siringetbase schema, not public — see supabase/migrations/0001_init.sql)
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  // Publishable key (sb_publishable_...) — Supabase's current replacement
  // for the legacy anon key, same low-privilege semantics (RLS behaves the
  // same), same client-safe/public exposure model. Legacy anon keys are
  // being deprecated end of 2026 — see
  // https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys.
  supabasePublishableKey: () =>
    required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  supabaseServiceRoleKey: () =>
    required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),

  // Neo4j — the Entity Graph (see ../../entity-graph/README.md). Credentials
  // are Tier 1 secrets, bound as Worker Secrets in production, .env.local
  // for local dev — never in wrangler.jsonc.
  neo4jUri: () => required("NEO4J_URI", process.env.NEO4J_URI),
  neo4jUser: () => required("NEO4J_USER", process.env.NEO4J_USER),
  neo4jPassword: () => required("NEO4J_PASSWORD", process.env.NEO4J_PASSWORD),
  // Optional — defaults to "neo4j", which is correct for most fresh AuraDB
  // Free/Professional instances, but not universal (confirmed the hard way:
  // some instances use a different database name). Check Aura console →
  // your instance → Connect, or run `SHOW DATABASES` in Neo4j Browser, if
  // the default doesn't work.
  neo4jDatabase: () => process.env.NEO4J_DATABASE ?? "neo4j",

  // Payments — which mock adapter is active behind PaymentGatewayPort /
  // BankPayoutPort (see ../../payments/README.md). Provider *names* are not
  // secret (they're in wrangler.jsonc's vars); real gateway/bank API keys,
  // once they exist, would be Worker Secrets, read here but never logged.
  paymentGatewayProvider: () =>
    (process.env.PAYMENT_GATEWAY_PROVIDER ?? "razorpay-mock") as
      | "razorpay-mock"
      | "payu-mock"
      | "cashfree-mock",
  bankPayoutProvider: () =>
    (process.env.BANK_PAYOUT_PROVIDER ?? "icici-mock") as
      | "icici-mock"
      | "hdfc-mock"
      | "axis-mock"
      | "sbi-mock",

  // Comms — shared email pipeline (../../comms/README.md). Resend is the
  // first (and, today, only) EmailSenderPort implementation — see
  // src/lib/comms/provider-registry.ts. All Tier 1 secrets except the
  // from-address, which is public-facing (it's literally in every email's
  // From: header) but still lives here for one place to change it.
  resendApiKey: () => required("RESEND_API_KEY", process.env.RESEND_API_KEY),
  // The exact string Supabase's dashboard shows at hook-registration time
  // (Authentication → Hooks → Send Email), format "v1,whsec_<base64>" — see
  // src/lib/comms/verify-webhook.ts, which strips the prefix itself.
  sendEmailHookSecret: () => required("SEND_EMAIL_HOOK_SECRET", process.env.SEND_EMAIL_HOOK_SECRET),
  // Must be an address on a domain verified in Resend's dashboard (SPF/DKIM/
  // DMARC) — an unverified From: domain is the single most common reason a
  // transactional email silently never arrives, see ../../comms/README.md's
  // Rollout Plan step 1. Default below points at email.siringet.com, which
  // is already Verified in Resend (confirmed 2026-07-18) — override per
  // vertical later if each one wants its own subdomain/address instead of
  // sharing this one.
  commsFromEmail: () => process.env.COMMS_FROM_EMAIL ?? "CA Focus <onboarding@email.siringet.com>",
};
