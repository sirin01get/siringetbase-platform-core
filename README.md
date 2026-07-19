# Siringetbase Platform Core

Phase 0 of the Siringetbase build: Identity, Entity Graph, and Payments, as designed in [`../README.md`](../README.md) and its subsystem docs ([`../identity/`](../identity/README.md), [`../entity-graph/`](../entity-graph/README.md), [`../payments/`](../payments/README.md)). This is the foundation every vertical (CA Focus, Build Focus) depends on before any persona-facing feature gets built.

## What's real in this phase

- Project structure, Cloudflare deployment pipeline (Next.js + `@opennextjs/cloudflare`), same pattern as `homeai/homeai` and `graphknowledge/graph-app`.
- Supabase schema (`supabase/migrations/0001_init.sql` + `0002_sync_retry_hardening.sql`): `role_profiles`, `businesses`, the Payments skeleton (`payments`, `invoices`, `escrow_holds`, `commission_ledger`, `payout_accounts`, `provider_transactions`), and `entity_sync_queue` — the Postgres→Neo4j sync outbox, with retry/backoff columns — all with Row-Level Security.
- Neo4j bootstrap (`src/lib/neo4j/schema.cypher`): constraints/indexes for `:Person`, `:Business`, `:ServiceProvider`, `:Engagement`, `:ServiceType`. Talks to Neo4j over its **Query API** (plain HTTPS via `fetch()`, `src/lib/neo4j/client.ts`), not `neo4j-driver`/Bolt — Cloudflare Workers cannot open the raw TCP connection Bolt needs, so the Bolt driver cannot work here at all, regardless of configuration. See Troubleshooting below.
- Entity-graph sync (`src/lib/entity-graph/sync.ts`): drains the outbox on a **Cloudflare Cron Trigger** (`worker.ts`, every minute — see `../entity-graph/data-sync-architecture.md`), batches Neo4j writes by label combination, retries failed rows with exponential backoff up to 5 attempts before marking them `dead_letter`, and reports queue backlog (`pendingCount`, `oldestPendingAgeSeconds`, `deadLetterCount`) via `/api/diagnostics`. Also exposed as `POST /api/entity-graph/sync` for manual/immediate draining. A role in `SERVICE_PROVIDER_ROLES` (currently `ca`, `builder`, `architect`) gets an additional `:ServiceProvider` label — this is also what `../billing/` uses to decide who owes revenue-share.
- Payments (`src/lib/payments/`): `PaymentGatewayPort` + `BankPayoutPort` interfaces, seven mock adapters (Razorpay/PayU/Cashfree for collection; ICICI/HDFC/Axis/SBI for payout), an env-driven registry, and the `hold`/`release`/`reverse` escrow primitives.
- Admin sync-queue view (`/admin/sync-queue`, `app/api/admin/sync-queue/route.ts` + `.../retry/route.ts`): lists `dead_letter`/legacy-`failed`/still-backing-off rows and lets someone select and manually retry-and-push them. A narrow, single-purpose page — **not** the full cross-vertical operator console described in `../admin/README.md` (dispute review, ServiceProvider verification, fraud review), which remains a separate future build. No auth gate yet, same posture as the routes below.
- Comms (`src/lib/comms/`, design: `../comms/README.md`): `EmailSenderPort` + `ResendAdapter`, a (vertical, role, triggerEvent) template registry (`templates/registry.ts`, CA Focus's magic-link copy in `templates/ca.ts`, a role-agnostic fallback in `templates/fallback.ts`, platform-internal templates in `templates/support.ts`), Standard Webhooks HMAC verification (`verify-webhook.ts`), and the `notification_dispatch` delivery log (`0006_notification_dispatch.sql`). Three entry points converge on all of this: `POST /api/comms/auth-email-hook` (Supabase's Send Email Hook target — auth-lifecycle email), `sendNotification()` (`send-notification.ts` — direct in-process calls, not yet called from any route), and `POST /api/comms/notify` (`app/api/comms/notify/route.ts` — the HTTP wrapper around `sendNotification()` for cross-Worker callers, secret-header-protected via `COMMS_INTERNAL_SECRET`; first real caller is `../../cafocus/app`'s support-report route). **Auth-email hook built but not activated** — see `../comms/README.md`'s Rollout Plan step 2 for the exact dashboard steps (hook registration, Worker Secrets, Resend domain verification) still needed before a real email goes out through it. `/api/comms/notify` has the same activation gap: needs `COMMS_INTERNAL_SECRET` set identically here and on every calling vertical.
- Support Escalation (design: `../support-escalation/README.md`): the `support_error_reports` table (`0007_support_error_reports.sql`) and this project's half of the pipeline — the `POST /api/comms/notify` endpoint above plus `templates/support.ts`'s `support.error_report_filed` template. The capture UI, breadcrumb hook, and report-ingestion route live in `../../cafocus/app`, not here — this project only owns the shared table and the internal send.
- **Not real yet**: `../billing/`'s subscription/cost-plus/revenue-share tables (a follow-up migration), any real gateway/bank integration (mocks only, by design — see `../payments/README.md`), comms's non-auth in-process sends (marketer-invite/verification-decision emails — `sendNotification()` exists but nothing calls it yet), a `support_error_reports` admin triage queue view, and no product UI beyond the placeholder status page and admin sync-queue view above (siringetbase owns no *product* screens — see `../design-system/README.md`).

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values
npm run dev
```

Needs a Supabase project and a Neo4j instance (Aura's free tier works) to fully exercise `/api/diagnostics` and the entity-graph sync route. `/api/health` and `/api/payments/smoke-test` work with zero external configuration — the mocks have no dependency on either.

## Database setup

```bash
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

`0001_init.sql` creates everything in a dedicated **`siringetbase`** schema, not `public` — same reasoning as `homeai/homeai`'s migration: avoids collision with anything else sharing the project (a vertical's own schema, Supabase's own objects), and is why the migration is safe to re-run from scratch (`drop schema if exists siringetbase cascade` at the top) while there's no real data yet — **remove that line before this ever runs against a project with real users**.

`0002_sync_retry_hardening.sql` is additive — adds `attempts`/`next_attempt_at` columns and a `dead_letter` status to `entity_sync_queue` for retry-with-backoff (see `../entity-graph/data-sync-architecture.md` §4). `0003_document_intelligence_skeleton.sql` adds the Document Intelligence skeleton tables and an `'engagement'` `entity_sync_queue.entity_type`, consumed by `../../cafocus/app`'s Phase 1. `0004_role_profile_status_rejected.sql` adds a `'rejected'` `role_profiles.status`, consumed by `../../cafocus/app`'s Phase 2 CA verification queue (`/admin/ca-verifications`). `0005_referrals.sql` adds the `referrals`/`referral_broadcasts` tables backing the "Siringet Referred" program (`../referrals/README.md`), consumed directly by `../../cafocus/app`'s onboarding flow (`src/lib/referrals/service.ts`) — this platform-core project doesn't call into these tables itself, it only owns the schema. `0006_notification_dispatch.sql` adds the comms delivery log (`../comms/README.md`), written by this project's own `/api/comms/auth-email-hook` route and `sendNotification()` — a migration this project *does* query directly. `0007_support_error_reports.sql` adds the `support_error_reports` table (`../support-escalation/README.md`), written by `../../cafocus/app`'s ingestion route the same way it already writes `documents`/`role_profiles`/`referrals` — this project owns the schema but doesn't insert into it itself, only reads it indirectly via the `support.error_report_filed` notification `POST /api/comms/notify` triggers. All additive and idempotent — safe to run even after real data exists; `npx supabase db push` picks up all seven in order. If running by hand via Supabase Studio's SQL Editor instead (see the CLI-flakiness note below), run them in filename order.

### Exposing the `siringetbase` schema (one-time, per Supabase project)

1. Supabase dashboard → **Integrations** → **Data API** → **Settings**.
2. **Exposed schemas** → add `siringetbase` → Save.
3. If queries fail right after with a `PGRST106` schema error, wait ~30s for the PostgREST schema cache to pick up the change, or use **Reload schema** if available.

## Neo4j setup

1. Create an instance (Aura free tier is sufficient for Phase 0).
2. Run `src/lib/neo4j/schema.cypher` once against it — paste into Neo4j Browser, or script it via `cypher-shell`.
3. Set `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` in `.env.local` (local) or as Worker Secrets (deployed) — never in `wrangler.jsonc`.

## Verifying the entity-graph sync

```bash
# 1. Create a role_profile (e.g. via Supabase Studio's table editor, or a
#    signup flow once one exists) — the trigger enqueues a sync row automatically.
# 2. Drain the queue:
curl -X POST http://localhost:3000/api/entity-graph/sync
# 3. Check Neo4j Browser: MATCH (n) RETURN n — the node should be there,
#    labeled :ServiceProvider too if the role_profile's role is ca/builder/architect.
```

## Troubleshooting

`GET /api/diagnostics` checks both Supabase and Neo4j connectivity and names exactly which layer is broken (missing env var, schema not exposed, migration not run, bad credentials) — same pattern as `homeai/homeai`'s diagnostics route. Check this first before digging into DevTools.

### Neo4j: why this uses the Query API instead of `neo4j-driver`

Neo4j's Bolt protocol (what the official `neo4j-driver` package speaks) requires a raw TCP socket. Cloudflare Workers cannot open arbitrary TCP connections — Cloudflare has TCP/QUIC socket support in the pipeline, but `neo4j-driver` doesn't yet have a Workers-compatible transport built on it. Symptom if you try anyway: URI/credentials check out, but the driver reports `Could not perform discovery. No routing servers available` with an empty routing table — it never manages a real Bolt handshake, it just times out silently and reports nothing found.

The fix isn't configuration — it's transport. `src/lib/neo4j/client.ts` talks to Neo4j's **Query API** instead: plain HTTPS, POST a Cypher statement, get JSON back, works with `fetch()` exactly like any other Worker code. It's the officially supported route for environments without TCP (introduced Neo4j 5.19, enabled by default, and the only way in on Aura, which only exposes HTTPS on port 443 for it — see [Neo4j Query API docs](https://neo4j.com/docs/query-api/current/)). `NEO4J_URI` is still stored in its familiar `neo4j+s://...` Bolt form so the Aura Connect-screen copy/paste instructions above don't change — the client takes the hostname portion and always speaks HTTPS to it.

If you're extending `src/lib/entity-graph/sync.ts` or adding new Neo4j-backed features elsewhere in Siringetbase, use `runCypher()` from `src/lib/neo4j/client.ts`, not `neo4j-driver` directly — and apply the same Query-API approach in any other module on this Cloudflare + Next.js + OpenNext stack (`homeai/homeai`, `buildfocus/*`) that needs Neo4j from a Worker.

### Cloudflare env vars: build-time vs runtime — and how to prove which one you're getting

`NEXT_PUBLIC_*` vars are inlined into the compiled bundle at `next build` time — once built, they're hardcoded strings, not live lookups. This means they must be set under **Settings > Build > Build variables and secrets** on the Worker (only available to the build step), not **Settings > Variables & Secrets** (runtime-only, has zero effect on already-inlined values). Everything else (`SUPABASE_SERVICE_ROLE_KEY`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`) is server-only and read live via `process.env` at request time, so those belong in **Variables & Secrets** instead.

A boolean "configured: true/false" check cannot tell these two failure modes apart — a stale build with a placeholder baked in looks identical to a correctly-configured one, since the placeholder string is still non-empty. When a `connection-error` doesn't make sense given what's set in the dashboard, add a step that echoes the actual resolved value of any `NEXT_PUBLIC_*` var directly in the diagnostics response instead of just a boolean — it's safe to do this because `NEXT_PUBLIC_*` values are already shipped in client-side JS in production, so nothing sensitive is exposed by printing them server-side too:

```ts
report.supabase = {
  resolvedUrl: supabaseUrl ?? null, // not a secret — already public in the client bundle
  urlConfigured: Boolean(supabaseUrl),
  // ...
};
```

If `resolvedUrl` shows a placeholder or an unexpected value, the fix is a fresh build with the real build variable set (an empty commit is enough to retrigger Workers Builds' Git integration) — not a runtime secret change, which won't touch it. Apply this same pattern to any other module built on this Cloudflare + Next.js + OpenNext stack (`homeai/homeai`, `buildfocus/*`) if it ever shows a similarly unexplainable `NEXT_PUBLIC_*`-related connection error.

**Additional read — `in` narrowing vs `typeof` narrowing on probe results.** If you extend the raw-probe pattern above (bypassing an SDK to hit an API directly for a clearer error), prefer `typeof value === "string"` over `"key" in value` when narrowing a function's inferred return union. `in` narrowing is only fully reliable on **discriminated unions** — every member sharing a literal tag field TypeScript can check unambiguously (`{ kind: "ok"; body: string } | { kind: "error"; message: string }`). Two structurally disjoint shapes with no shared tag, especially when the union comes from inference on an `async` function rather than an explicit type annotation, is a weaker case — `"body" in rawProbe` may not fully eliminate `undefined` from `rawProbe.body` afterward, producing a `string | undefined` type error at the call site even though the property is genuinely always a string in that branch at runtime. `typeof` narrows on the value's own runtime type directly, independent of how the surrounding union was inferred, so it doesn't depend on TypeScript having tracked the union shape correctly. The more root-cause fix is to give the probe function an explicit return type annotation (removing the inference step) rather than leaning on narrowing to compensate for an implicit one — see `rawSupabaseProbe`'s signature in `app/api/diagnostics/route.ts` for the pattern.

## Deployment

```bash
npm run preview   # build + run locally in the actual Workers runtime
npm run deploy     # build + deploy to Cloudflare
```

If deploying via the Cloudflare dashboard's Git integration, set the project's **Build command** to `npm run cf:build`, not `npm run build` — same reasoning as `homeai/homeai`'s README: `cf:build` (the OpenNext step) internally calls `build` (plain `next build`), so pointing the dashboard's build command at `cf:build` directly avoids the infinite-recursion trap of doing it the other way around.

CI (`.github/workflows/ci.yml`) runs lint/typecheck/build on every push/PR as a verification gate — it does not deploy; Cloudflare Workers Builds' own Git integration owns that, avoiding a double-deploy race.

### Activating `POST /api/comms/notify` (Support Escalation's cross-Worker send)

Unlike the auth-email hook (dashboard registration required), this endpoint only needs Worker Secrets set — no external service to configure:

1. Set `COMMS_INTERNAL_SECRET` here (Settings → Variables & Secrets) to a long random value.
2. Set the **identical** value as `COMMS_INTERNAL_SECRET` on every calling vertical's deployment (today: `../../cafocus/app`).
3. Optionally set `SUPPORT_INBOX_EMAIL` here if the default (`support@email.siringet.com`) isn't where reports should land — see `src/config/env.ts`.
4. On the calling vertical, also set `PLATFORM_CORE_BASE_URL` to this project's deployed Workers URL (see the Troubleshooting entry above on finding it).

A mismatched or missing secret fails loudly with a 401 from `/api/comms/notify` — check both sides match exactly, including no trailing whitespace, if `cafocus/app`'s error reports aren't reaching support.

## Next

Once this is live and `/api/diagnostics` reports both stores healthy: CA Focus's own Phase 0 (`../../cafocus/phases/phase-0-siringetbase-foundation/`) registers `cafocus` as a consuming vertical against this foundation.
