# Siringetbase Platform Core

Phase 0 of the Siringetbase build: Identity, Entity Graph, and Payments, as designed in [`../README.md`](../README.md) and its subsystem docs ([`../identity/`](../identity/README.md), [`../entity-graph/`](../entity-graph/README.md), [`../payments/`](../payments/README.md)). This is the foundation every vertical (CA Focus, Build Focus) depends on before any persona-facing feature gets built.

## What's real in this phase

- Project structure, Cloudflare deployment pipeline (Next.js + `@opennextjs/cloudflare`), same pattern as `homeai/homeai` and `graphknowledge/graph-app`.
- Supabase schema (`supabase/migrations/0001_init.sql` + `0002_sync_retry_hardening.sql`): `role_profiles`, `businesses`, the Payments skeleton (`payments`, `invoices`, `escrow_holds`, `commission_ledger`, `payout_accounts`, `provider_transactions`), and `entity_sync_queue` — the Postgres→Neo4j sync outbox, with retry/backoff columns — all with Row-Level Security.
- Neo4j bootstrap (`src/lib/neo4j/schema.cypher`): constraints/indexes for `:Person`, `:Business`, `:ServiceProvider`, `:Engagement`, `:ServiceType`. Talks to Neo4j over its **Query API** (plain HTTPS via `fetch()`, `src/lib/neo4j/client.ts`), not `neo4j-driver`/Bolt — Cloudflare Workers cannot open the raw TCP connection Bolt needs, so the Bolt driver cannot work here at all, regardless of configuration. See Troubleshooting below.
- Entity-graph sync (`src/lib/entity-graph/sync.ts`): drains the outbox on a **Cloudflare Cron Trigger** (`worker.ts`, every minute — see `../entity-graph/data-sync-architecture.md`), batches Neo4j writes by label combination, retries failed rows with exponential backoff up to 5 attempts before marking them `dead_letter`, and reports queue backlog (`pendingCount`, `oldestPendingAgeSeconds`, `deadLetterCount`) via `/api/diagnostics`. Also exposed as `POST /api/entity-graph/sync` for manual/immediate draining. A role in `SERVICE_PROVIDER_ROLES` (currently `ca`, `builder`, `architect`) gets an additional `:ServiceProvider` label — this is also what `../billing/` uses to decide who owes revenue-share.
- Payments (`src/lib/payments/`): `PaymentGatewayPort` + `BankPayoutPort` interfaces, seven mock adapters (Razorpay/PayU/Cashfree for collection; ICICI/HDFC/Axis/SBI for payout), an env-driven registry, and the `hold`/`release`/`reverse` escrow primitives.
- **Not real yet**: `../billing/`'s subscription/cost-plus/revenue-share tables (a follow-up migration), any real gateway/bank integration (mocks only, by design — see `../payments/README.md`), and no UI beyond a placeholder status page (siringetbase owns no product screens — see `../design-system/README.md`).

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

`0002_sync_retry_hardening.sql` is additive — adds `attempts`/`next_attempt_at` columns and a `dead_letter` status to `entity_sync_queue` for retry-with-backoff (see `../entity-graph/data-sync-architecture.md` §4). Safe to run even after real data exists; `npx supabase db push` picks up both migrations in order. If running by hand via Supabase Studio's SQL Editor instead (see the CLI-flakiness note below), run `0001_init.sql` first, then `0002_sync_retry_hardening.sql`.

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

## Next

Once this is live and `/api/diagnostics` reports both stores healthy: CA Focus's own Phase 0 (`../../cafocus/phases/phase-0-siringetbase-foundation/`) registers `cafocus` as a consuming vertical against this foundation.
