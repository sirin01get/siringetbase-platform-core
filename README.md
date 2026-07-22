# Siringetbase Platform Core

Phase 0 of the Siringetbase build: Identity, Entity Graph, and Payments, as designed in [`../README.md`](../README.md) and its subsystem docs ([`../identity/`](../identity/README.md), [`../entity-graph/`](../entity-graph/README.md), [`../payments/`](../payments/README.md)). This is the foundation every vertical (CA Focus, Build Focus) depends on before any persona-facing feature gets built.

## What's real in this phase

- Project structure, Cloudflare deployment pipeline (Next.js + `@opennextjs/cloudflare`), same pattern as `homeai/homeai` and `graphknowledge/graph-app`.
- Supabase schema (`supabase/migrations/0001_init.sql` + `0002_sync_retry_hardening.sql`): `role_profiles`, `businesses`, the Payments skeleton (`payments`, `invoices`, `escrow_holds`, `commission_ledger`, `payout_accounts`, `provider_transactions`), and `entity_sync_queue` — the Postgres→Neo4j sync outbox, with retry/backoff columns — all with Row-Level Security.
- Neo4j bootstrap (`src/lib/neo4j/schema.cypher`): constraints/indexes for `:Person`, `:Business`, `:ServiceProvider`, `:Engagement`, `:ServiceType`. Talks to Neo4j over its **Query API** (plain HTTPS via `fetch()`, `src/lib/neo4j/client.ts`), not `neo4j-driver`/Bolt — Cloudflare Workers cannot open the raw TCP connection Bolt needs, so the Bolt driver cannot work here at all, regardless of configuration. See Troubleshooting below.
- Entity-graph sync (`src/lib/entity-graph/sync.ts`): drains the outbox on a **Cloudflare Cron Trigger** (`worker.ts`, every minute — see `../entity-graph/data-sync-architecture.md`), batches Neo4j writes by label combination, retries failed rows with exponential backoff up to 5 attempts before marking them `dead_letter`, and reports queue backlog (`pendingCount`, `oldestPendingAgeSeconds`, `deadLetterCount`) via `/api/diagnostics`. Also exposed as `POST /api/entity-graph/sync` for manual/immediate draining. A role in `SERVICE_PROVIDER_ROLES` (currently `ca`, `builder`, `architect`) gets an additional `:ServiceProvider` label — this is also what `../billing/` uses to decide who owes revenue-share.
- Payments (`src/lib/payments/`): `PaymentGatewayPort` + `BankPayoutPort` interfaces, seven mock adapters (Razorpay/PayU/Cashfree for collection; ICICI/HDFC/Axis/SBI for payout), an env-driven registry, and the `hold`/`release`/`reverse` escrow primitives.
- Admin sync-queue view (`/admin/sync-queue`, `app/api/admin/sync-queue/route.ts` + `.../retry/route.ts`): lists `dead_letter`/legacy-`failed`/still-backing-off rows and lets someone select and manually retry-and-push them. A narrow, single-purpose page — **not** the full cross-vertical operator console described in `../admin/README.md` (dispute review, ServiceProvider verification, fraud review), which remains a separate future build. `support_admin` only now — real per-admin session + audit trail, not the open-to-anyone posture this had before. See "Admin access control" below.
- Comms (`src/lib/comms/`, design: `../comms/README.md`): `EmailSenderPort` + `ResendAdapter`, a (vertical, role, triggerEvent) template registry (`templates/registry.ts`, CA Focus's magic-link copy in `templates/ca.ts`, a role-agnostic fallback in `templates/fallback.ts`, platform-internal templates in `templates/support.ts`), Standard Webhooks HMAC verification (`verify-webhook.ts`), and the `notification_dispatch` delivery log (`0006_notification_dispatch.sql`). Three entry points converge on all of this: `POST /api/comms/auth-email-hook` (Supabase's Send Email Hook target — auth-lifecycle email), `sendNotification()` (`send-notification.ts` — direct in-process calls, not yet called from any route), and `POST /api/comms/notify` (`app/api/comms/notify/route.ts` — the HTTP wrapper around `sendNotification()` for cross-Worker callers, secret-header-protected via `COMMS_INTERNAL_SECRET`; first real caller is `../../cafocus/app`'s support-report route). **Auth-email hook built but not activated** — see `../comms/README.md`'s Rollout Plan step 2 for the exact dashboard steps (hook registration, Worker Secrets, Resend domain verification) still needed before a real email goes out through it. `/api/comms/notify` has the same activation gap: needs `COMMS_INTERNAL_SECRET` set identically here and on every calling vertical.
- Support Escalation (design: `../support-escalation/README.md`): the `support_error_reports` table (`0007_support_error_reports.sql`) and this project's half of the pipeline — the `POST /api/comms/notify` endpoint above plus `templates/support.ts`'s `support.error_report_filed` template. The capture UI, breadcrumb hook, and report-ingestion route live in `../../cafocus/app`, not here — this project only owns the shared table and the internal send.
- Billing rate card (`0008_billing_rate_cards.sql`, `src/lib/billing/rate-card.ts`, design: `../billing/README.md`): the first real, effective-dated implementation of `../billing/`'s `revenue_share_rates` and `subscription_plans` concepts, product-named **"Platform charges"** (`platform_charge_rates` — percentage, deducted at payout, scoped by vertical + optional `service_type_slug`) and **"platform membership fee"** (`platform_membership_fees` — fixed recurring amount, scoped by vertical + role and `billing_cycle`). Both tables store full history via `effective_from`/`effective_to` rather than a single current value — `create*` in `rate-card.ts` closes out the previous open-ended row for a scope before inserting the new one, so a future-dated rate can be scheduled without disturbing what's live today. Managed by a `business_admin`-only control plane at `/admin/billing` (`app/api/admin/billing/platform-charge-rates/route.ts`, `.../platform-membership-fees/route.ts`, `app/admin/billing/page.tsx`) — real per-admin session + audit trail (every rate/fee created is logged with its full detail), see "Admin access control" below. `platform_charge_rates` is read directly (not via a cross-Worker endpoint) by `../../cafocus/app` at payout time; `platform_membership_fees` is manageable here but has no active recurring-billing job consuming it yet.
- ServiceType adjacency seed (`src/lib/neo4j/schema.cypher`'s tail section, CA Focus Phase 5 marketplace slice 9): a small, hand-picked `(:ServiceType)-[:ADJACENT_TO]-(:ServiceType)` seed between `tax-filing` and `gst-filing` — `auditing` deliberately excluded, it needs distinct qualification. `../../cafocus/app`'s `listCaDirectory()` reads this to suggest a related specialty when an exact-type search comes up with zero active CAs, rather than an empty directory or a broadcast to everyone.
- Activity analytics (`0009_activity_analytics.sql`, design: `../user-analytics/README.md`): the first real code against that subsystem's design — `activity_event_types` (seeded with CA Focus's illustrative taxonomy), `activity_events`, `activity_consent`, all consent-gated per the DPDP compliance research doc. This project has no reader/writer of its own yet — `../../cafocus/app`'s `src/lib/activity-analytics/track.ts` is the first real consumer, writing directly against these shared tables (same pattern as `platform_charge_rates`), with an off-by-default opt-in toggle on its CA directory.
- Admin access control (`0010_admin_audit_log.sql`, `src/lib/admin/{auth,audit}.ts`): real, individually-identified `business_admin`/`support_admin` accounts (`siringetbase.role_profiles` rows, `vertical: 'siringetbase'`) gate every `/admin/*` page and `/api/admin/*` route in **both** this project and `../../cafocus/app`, replacing what used to be either no auth at all or a shared-credential stopgap. `admin_audit_log` (this migration) is the shared audit table both apps write to — actor, role, action, target, outcome, IP/user-agent — including denied attempts, not just successful ones. Full design and the admin-provisioning steps are documented once, in `../../cafocus/app/README.md`'s "Access control" section, since the identity table and audit table are shared; this project's own `/admin/login` (`app/admin/login/page.tsx`) is the same magic-link mechanism, just a separate session (different origin). **An account can now hold both admin roles at once** (a deliberate, temporary workaround, not the long-term target — real segregation-of-duties enforcement is still future work) — `src/lib/admin/role-conflict-resolver.ts` (duplicated in both projects) is the seam that decides which role "wins" when both apply; today it's a permissive stub that always approves and logs a `role_conflict.auto_approved` audit entry whenever it actually had a choice to make. See [`../admin/README.md`](../admin/README.md) for the full workaround-vs-future-SOX-strategy writeup.
- **Not real yet**: `../billing/`'s cost-plus/usage-metering tables and any active recurring-billing job to actually collect the "platform membership fee" (the rate card above only stores the number — nothing charges against it yet), any real gateway/bank integration (mocks only, by design — see `../payments/README.md`), comms's non-auth in-process sends (marketer-invite/verification-decision emails — `sendNotification()` exists but nothing calls it yet), a `support_error_reports` admin triage queue view, a real ServiceType *hierarchy* (the adjacency above is one hand-picked pair, not a generated tree), and no product UI beyond the placeholder status page and admin views above (siringetbase owns no *product* screens — see `../design-system/README.md`).

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values
npm run dev
```

Needs a Supabase project and a Neo4j instance (Aura's free tier works) to fully exercise `/api/diagnostics` and the entity-graph sync route. `/api/health` and `/api/payments/smoke-test` work with zero external configuration — the mocks have no dependency on either.

## Database setup

```bash
npm install               # pulls in the pinned supabase devDependency below
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

`supabase` is pinned as an exact-version `devDependency` (`package.json`, currently `2.109.1`), not invoked as a bare ad hoc `npx supabase <command>`. This matters more than it looks: Supabase's own docs recommend exactly this pattern (project-scoped install via npm, not a global install) specifically because a global/ad hoc install has a well-documented history of Windows-specific breakage — wrong PATH entries, antivirus flagging the downloaded binary, broken installs after a Node upgrade — the same class of problem this project hit early on and originally worked around by hand-pasting SQL into Supabase Studio instead. Pinning the version also means every machine on this project resolves the identical CLI build, not whatever `npx` happens to fetch that day. `npm run db:link` / `npm run db:push` are shorthand for the two commands above, once linked.

**Fallback, if the CLI still won't run on your machine**: paste a migration's SQL directly into Supabase Studio's SQL Editor instead — functionally identical, since every migration in this repo is written idempotently (`create table if not exists`, `add column if not exists`). The real risk with that route isn't the SQL itself, it's that Studio pastes don't update Supabase's own migration-history tracking table, so a later `supabase db push` won't know that migration was already applied — it'll just try to re-run it, which is safe here specifically *because* everything's idempotent, but isn't something to rely on long-term. Prefer `db push` once the CLI is working.

`0001_init.sql` creates everything in a dedicated **`siringetbase`** schema, not `public` — same reasoning as `homeai/homeai`'s migration: avoids collision with anything else sharing the project (a vertical's own schema, Supabase's own objects), and is why the migration is safe to re-run from scratch (`drop schema if exists siringetbase cascade` at the top) while there's no real data yet — **remove that line before this ever runs against a project with real users**.

`0002_sync_retry_hardening.sql` is additive — adds `attempts`/`next_attempt_at` columns and a `dead_letter` status to `entity_sync_queue` for retry-with-backoff (see `../entity-graph/data-sync-architecture.md` §4). `0003_document_intelligence_skeleton.sql` adds the Document Intelligence skeleton tables and an `'engagement'` `entity_sync_queue.entity_type`, consumed by `../../cafocus/app`'s Phase 1. `0004_role_profile_status_rejected.sql` adds a `'rejected'` `role_profiles.status`, consumed by `../../cafocus/app`'s Phase 2 CA verification queue (`/admin/ca-verifications`). `0005_referrals.sql` adds the `referrals`/`referral_broadcasts` tables backing the "Siringet Referred" program (`../referrals/README.md`), consumed directly by `../../cafocus/app`'s onboarding flow (`src/lib/referrals/service.ts`) — this platform-core project doesn't call into these tables itself, it only owns the schema. `0006_notification_dispatch.sql` adds the comms delivery log (`../comms/README.md`), written by this project's own `/api/comms/auth-email-hook` route and `sendNotification()` — a migration this project *does* query directly. `0007_support_error_reports.sql` adds the `support_error_reports` table (`../support-escalation/README.md`), written by `../../cafocus/app`'s ingestion route the same way it already writes `documents`/`role_profiles`/`referrals` — this project owns the schema but doesn't insert into it itself, only reads it indirectly via the `support.error_report_filed` notification `POST /api/comms/notify` triggers. `0008_billing_rate_cards.sql` adds the platform-charge-rate/membership-fee tables described above. `0009_activity_analytics.sql` adds the consent-gated activity-analytics tables. `0010_admin_audit_log.sql` adds `admin_audit_log` (see "Admin access control" above) — written by both this project's and `../../cafocus/app`'s `src/lib/admin/audit.ts`. All additive and idempotent — safe to run even after real data exists; `npx supabase db push` picks up all ten in order. If running by hand via Supabase Studio's SQL Editor instead (see the fallback note above), run them in filename order.

### Shared-database migration numbering (cafocus/app, PMMUSA)

This project's Supabase database isn't exclusive to `platform-core` — `../../cafocus/app` and the PMMUSA project also push their own, independently-numbered `supabase/migrations` folders against the same physical database (each starts its own sequence at `0001`). Supabase's migration-history table (`supabase_migrations.schema_migrations`) lives in that one shared database, not per-repo, so whichever repo's CLI reaches a given version number *first* claims that slot — a later repo's `db push` will then see a remote row for that version whose name doesn't match anything in its own local folder, and refuse to push at all with "Remote migration versions not found in local migrations directory."

Discovered 2026-07-22: platform-core's own `0002`, `0004`, `0006`, `0008`, `0009`, `0013`, and `0014` had all been claimed by cafocus/app's or PMMUSA's migrations on the shared project (`vnglypdfuzwlcmqopcyg`). `0002`/`0004`'s intended schema changes (entity_sync_queue retry columns/`dead_letter` status, `role_profiles.status` allowing `'rejected'`) turned out to already be present in the live database regardless — reconciled with `supabase migration repair --status applied 0002` / `... 0004`. `0006`/`0008`/`0009` were genuinely never applied — `notification_dispatch`, `platform_charge_rates`/`platform_membership_fees`, and the `activity_*` tables didn't exist — reconciled with `supabase migration repair --status reverted 0006` / `0008` / `0009`, then a normal `db push` created them for real (safe specifically because every migration here is `create table if not exists`/idempotent). `0013` and `0014` were purely cafocus/app's (`client_requirements`, `client_invite_offers`) and never will be platform-core's — reconciled with `--status reverted` for both, and this project's own next migration was numbered `0015` to skip past them rather than trying to reclaim those slots.

**Before assuming a repair command is safe**, check what the target version's status change actually requires: `--status reverted` (telling the CLI "this version isn't mine, forget it") is safe to follow with a normal `db push` only when the local migration file being skipped is idempotent — which every migration in this repo is. `--status applied` (telling the CLI "this version's effect already exists, don't try to (re)apply it") is the right call when a schema check (`information_schema.tables`, `pg_constraint`) shows the desired end state is already real, achieved by someone else's differently-numbered migration — most of this repo's early migrations aren't written to tolerate being re-run against a state where their `ADD COLUMN`/`ADD CONSTRAINT` already succeeded once (no `IF NOT EXISTS` guard on those two specific statement types), so marking them `reverted` and letting `db push` retry them would fail. When in doubt, check `information_schema.tables`/`pg_constraint` for the real state before repairing anything — never run `supabase db pull` to "fix" this, since that would pull the *entire* shared schema (including every other project's tables) into a new local migration file here, which conflicts with each repo owning only its own schema's migrations.

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

### Activating `POST /api/document-intelligence/extract` (Document Intelligence's cross-Worker call)

Same shared-secret pattern as above, plus one extra one-time step since this endpoint calls Workers AI:

1. Set `DOCUMENT_INTELLIGENCE_INTERNAL_SECRET` here (Settings → Variables & Secrets) to a long random value.
2. Set the **identical** value as `DOCUMENT_INTELLIGENCE_INTERNAL_SECRET` on every calling vertical's deployment (today: `../../cafocus/app`, which also reuses its existing `PLATFORM_CORE_BASE_URL`).
3. **Accept Meta's license for the vision model, once per Cloudflare account** — `@cf/meta/llama-3.2-11b-vision-instruct` (`src/lib/document-intelligence/model-gateway.ts`) refuses every call until this happens, and the error it returns doesn't make that obvious. Run:
   ```bash
   curl https://api.cloudflare.com/client/v4/accounts/<CLOUDFLARE_ACCOUNT_ID>/ai/run/@cf/meta/llama-3.2-11b-vision-instruct \
     -H "Authorization: Bearer <CLOUDFLARE_API_TOKEN>" \
     -d '{"prompt":"agree"}'
   ```
   The API token needs Workers AI edit permission. This is a one-time, per-account step — it doesn't need repeating after redeploys.

A mismatched/missing secret fails loudly with a 401; a not-yet-accepted license fails with an error from the model call itself (visible in `extraction_jobs.raw_output` and platform-core's Workers logs) — check step 3 first if extraction results are all landing as `failed`.

No extraction template exists yet for a document uploaded with `document_type: "other"` (or `"investment_proof"`/`"bank_statement"`) — that's expected, not a bug: `extractDocument()` returns `{ status: "skipped" }` and leaves `documents.status` at `"uploaded"`. See `../document-intelligence/README.md`'s "Template Registry, Not Template Ownership" section for which document types actually have one.

### Activating `POST /api/payments/hold`, `.../release`, and `.../reverse` (Payments' cross-Worker calls)

Same shared-secret pattern as above — no external service to configure, unlike Document Intelligence's Meta-license step:

1. Set `PAYMENTS_INTERNAL_SECRET` here (Settings → Variables & Secrets) to a long random value.
2. Set the **identical** value as `PAYMENTS_INTERNAL_SECRET` on every calling vertical's deployment (today: `../../cafocus/app`, which also reuses its existing `PLATFORM_CORE_BASE_URL`).

All three routes are thin wrappers over `src/lib/payments/escrow.ts`'s `hold()`/`release()`/`reverse()` — the active `PaymentGatewayPort`/`BankPayoutPort` mock adapters (`PAYMENT_GATEWAY_PROVIDER`/`BANK_PAYOUT_PROVIDER`, already configured per "What's real in this phase" above) do the actual charge/payout/refund simulation; nothing new to configure there. `reverse` is the newest of the three (cafocus/app's cancellation flow) but needs no separate secret — one `PAYMENTS_INTERNAL_SECRET` covers all three. A mismatched/missing secret fails loudly with a 401, same as the other two internal endpoints.

## Next

Once this is live and `/api/diagnostics` reports both stores healthy: CA Focus's own Phase 0 (`../../cafocus/phases/phase-0-siringetbase-foundation/`) registers `cafocus` as a consuming vertical against this foundation.
