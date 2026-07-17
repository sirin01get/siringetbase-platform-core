# Siringetbase Platform Core

Phase 0 of the Siringetbase build: Identity, Entity Graph, and Payments, as designed in [`../README.md`](../README.md) and its subsystem docs ([`../identity/`](../identity/README.md), [`../entity-graph/`](../entity-graph/README.md), [`../payments/`](../payments/README.md)). This is the foundation every vertical (CA Focus, Build Focus) depends on before any persona-facing feature gets built.

## What's real in this phase

- Project structure, Cloudflare deployment pipeline (Next.js + `@opennextjs/cloudflare`), same pattern as `homeai/homeai` and `graphknowledge/graph-app`.
- Supabase schema (`supabase/migrations/0001_init.sql`): `role_profiles`, `businesses`, the Payments skeleton (`payments`, `invoices`, `escrow_holds`, `commission_ledger`, `payout_accounts`, `provider_transactions`), and `entity_sync_queue` — the Postgres→Neo4j sync outbox — all with Row-Level Security.
- Neo4j bootstrap (`src/lib/neo4j/schema.cypher`): constraints/indexes for `:Person`, `:Business`, `:ServiceProvider`, `:Engagement`, `:ServiceType`.
- Entity-graph sync (`src/lib/entity-graph/sync.ts`, `POST /api/entity-graph/sync`): drains the outbox, upserts Neo4j nodes. A role in `SERVICE_PROVIDER_ROLES` (currently `ca`, `builder`, `architect`) gets an additional `:ServiceProvider` label — this is also what `../billing/` uses to decide who owes revenue-share.
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

## Deployment

```bash
npm run preview   # build + run locally in the actual Workers runtime
npm run deploy     # build + deploy to Cloudflare
```

If deploying via the Cloudflare dashboard's Git integration, set the project's **Build command** to `npm run cf:build`, not `npm run build` — same reasoning as `homeai/homeai`'s README: `cf:build` (the OpenNext step) internally calls `build` (plain `next build`), so pointing the dashboard's build command at `cf:build` directly avoids the infinite-recursion trap of doing it the other way around.

CI (`.github/workflows/ci.yml`) runs lint/typecheck/build on every push/PR as a verification gate — it does not deploy; Cloudflare Workers Builds' own Git integration owns that, avoiding a double-deploy race.

## Next

Once this is live and `/api/diagnostics` reports both stores healthy: CA Focus's own Phase 0 (`../../cafocus/phases/phase-0-siringetbase-foundation/`) registers `cafocus` as a consuming vertical against this foundation.
