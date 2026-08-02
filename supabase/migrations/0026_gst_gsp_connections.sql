-- GST-GSP connector (../../gst-gsp/README.md) — the per-taxpayer OAuth
-- consent state and per-return push log for cafocus's ASP integration on
-- top of a licensed GSP. organization_id is deliberately NOT a foreign
-- key — same "opaque reference into a vertical's own schema" posture
-- siringetbase.payments.engagement_id already uses (0001_init.sql), since
-- cafocus.organizations lives in cafocus/app's own Postgres project, not
-- this one.
--
-- Two tables, matching the README's "Two-Layer OAuth" + push lifecycle:
-- gst_connections is the per-GSTIN consent grant (layer 2 of the OAuth
-- model; layer 1 — cafocus's own app-level GSP client credentials — is a
-- Worker Secret, not a table, same as every other Tier 1 credential); this
-- table's access_token/refresh_token columns are themselves Tier 1
-- secrets (../../security/README.md) and must never be returned in a
-- client-facing API response body — service.ts only ever exposes
-- connectionReference/status/gstin out of this table, never the tokens.
-- gst_return_pushes is one row per attempt to push a prepared return.
--
-- provider_transactions (0001_init.sql) already has a nullable
-- payment_id/escrow_hold_id pair for its raw request/response audit trail
-- — gst_return_push_id extends that same table rather than duplicating a
-- second audit-log table, so reconciliation tooling doesn't need to know
-- which rail a row came from to read it.
--
-- Idempotent — safe to re-run.

create table if not exists siringetbase.gst_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,        -- opaque reference, see note above
  vertical text not null,
  gstin text not null,
  provider text not null,               -- e.g. 'generic-gsp-mock' — see src/lib/gst-gsp/registry.ts
  connection_reference text not null,   -- the GstGatewayPort.connect() result's connectionReference
  status text not null default 'pending' check (status in ('connected', 'failed', 'pending', 'revoked')),
  access_token text,                    -- Tier 1 secret — see header comment
  refresh_token text,                   -- Tier 1 secret — see header comment
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists gst_connections_organization_id_idx
  on siringetbase.gst_connections(organization_id);

create unique index if not exists gst_connections_gstin_active_idx
  on siringetbase.gst_connections(gstin)
  where status = 'connected';

create table if not exists siringetbase.gst_return_pushes (
  id uuid primary key default gen_random_uuid(),
  gst_connection_id uuid not null references siringetbase.gst_connections(id),
  filing_id uuid,                       -- opaque reference to cafocus.filings — never a FK, see note above
  period text not null,                 -- matches cafocus.filings.period's shape, e.g. 'Q1-FY2026'
  push_reference text not null,         -- the GstGatewayPort.pushReturn() result's pushReference
  status text not null default 'queued' check (status in ('queued', 'submitted', 'filed', 'rejected')),
  gsp_acknowledgment_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gst_return_pushes_gst_connection_id_idx
  on siringetbase.gst_return_pushes(gst_connection_id);

create index if not exists gst_return_pushes_filing_id_idx
  on siringetbase.gst_return_pushes(filing_id);

alter table siringetbase.provider_transactions
  add column if not exists gst_return_push_id uuid references siringetbase.gst_return_pushes(id);

alter table siringetbase.gst_connections enable row level security;
alter table siringetbase.gst_return_pushes enable row level security;

-- No direct end-user policy yet — both tables are keyed by opaque
-- organization_id/filing_id, not role_profile_id, so scoping them
-- correctly needs the vertical's own organizations/filings tables to join
-- against. Service-role only until a vertical schema exists to extend
-- this, same posture escrow_holds/provider_transactions already have
-- (0001_init.sql).

grant all on siringetbase.gst_connections to service_role;
grant all on siringetbase.gst_return_pushes to service_role;
