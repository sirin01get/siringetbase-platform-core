-- Siringetbase platform core — Phase 0 schema
-- Identity (role_profiles, businesses), the Postgres→Neo4j sync outbox, and
-- the Payments skeleton (per ../../identity/README.md, ../../entity-graph/README.md,
-- ../../payments/README.md). Billing (subscription_plans, usage_meters,
-- cost_plus_rates, revenue_share_rates, platform_invoices) is intentionally
-- NOT in this migration — that's ../../billing/, a follow-up migration once
-- this foundation is live.
--
-- Lives in a dedicated `siringetbase` schema, not `public` — same reasoning
-- as homeai/homeai's migration: avoids collision with anything else sharing
-- the Supabase project (a vertical's own schema, Supabase's own objects).
--
-- Safe to re-run from scratch ONLY while there is no real data yet — the
-- `drop schema cascade` below must be removed before this ever runs against
-- a project with real users/payments in it.

drop schema if exists siringetbase cascade;
create schema siringetbase;

-- ---------------------------------------------------------------------------
-- Identity (../../identity/README.md)
-- ---------------------------------------------------------------------------

-- One row per registered business entity. A `:Business` in the entity graph.
create table siringetbase.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  registration_number text,
  owner_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- The vertical-scoping table — identity itself is NOT vertical-scoped
-- (auth.users), but participation in a vertical, in a specific role, is.
-- Exactly one of user_id / business_id must be set: a role_profile belongs
-- to a person OR a business, never both, never neither.
create table siringetbase.role_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  business_id uuid references siringetbase.businesses(id),
  vertical text not null,               -- e.g. 'cafocus', 'buildfocus'
  role text not null,                   -- e.g. 'individual', 'smb_owner', 'ca', 'homebuyer', 'builder', 'architect', 'admin'
  status text not null default 'active' check (status in ('active', 'pending_verification', 'suspended')),
  created_at timestamptz not null default now(),
  constraint role_profile_exactly_one_owner check (
    (user_id is not null and business_id is null) or
    (user_id is null and business_id is not null)
  )
);

create index role_profiles_user_id_idx on siringetbase.role_profiles(user_id);
create index role_profiles_business_id_idx on siringetbase.role_profiles(business_id);
create index role_profiles_vertical_role_idx on siringetbase.role_profiles(vertical, role);

-- ---------------------------------------------------------------------------
-- Entity Graph sync outbox (../../entity-graph/README.md)
-- Postgres stays the source of truth for identity; this table is the
-- durable queue a scheduled Worker drains to upsert Neo4j nodes. Never read
-- from directly by application code beyond the sync job itself.
-- ---------------------------------------------------------------------------

create table siringetbase.entity_sync_queue (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('person', 'business', 'service_provider')),
  entity_id uuid not null,              -- role_profiles.id or businesses.id
  vertical text not null,
  operation text not null check (operation in ('upsert', 'delete')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index entity_sync_queue_pending_idx on siringetbase.entity_sync_queue(status) where status = 'pending';

-- Enqueue a sync row whenever a role_profile is created or its status
-- changes — src/lib/entity-graph/sync.ts drains this queue and upserts the
-- corresponding :Person/:Business/:ServiceProvider node in Neo4j.
create or replace function siringetbase.enqueue_entity_sync()
returns trigger as $$
begin
  insert into siringetbase.entity_sync_queue (entity_type, entity_id, vertical, operation, payload)
  values (
    case when new.user_id is not null then 'person' else 'business' end,
    new.id,
    new.vertical,
    'upsert',
    jsonb_build_object(
      'role_profile_id', new.id,
      'user_id', new.user_id,
      'business_id', new.business_id,
      'vertical', new.vertical,
      'role', new.role,
      'status', new.status
    )
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger role_profiles_sync_trigger
  after insert or update on siringetbase.role_profiles
  for each row execute function siringetbase.enqueue_entity_sync();

-- ---------------------------------------------------------------------------
-- Payments skeleton (../../payments/README.md) — mechanics only; rates and
-- entity billing tiers live in ../../billing/, a later migration.
-- engagement_id is deliberately NOT a foreign key — a vertical's own
-- `engagements` table lives in that vertical's own schema/project, built
-- later. Siringetbase's payments tables are referenced BY verticals, not the
-- other way around (see payments/README.md's boundary rule).
-- ---------------------------------------------------------------------------

create table siringetbase.payments (
  id uuid primary key default gen_random_uuid(),
  role_profile_id uuid not null references siringetbase.role_profiles(id), -- the payer
  vertical text not null,
  engagement_id uuid,                   -- opaque reference into a vertical's own schema
  amount numeric(12, 2) not null,
  currency text not null default 'INR',
  type text not null check (type in ('collection', 'payout', 'refund')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  gateway_provider text,                -- e.g. 'razorpay-mock' — see src/lib/payments/registry.ts
  created_at timestamptz not null default now()
);

create table siringetbase.invoices (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references siringetbase.payments(id),
  vertical text not null,
  line_items jsonb not null default '[]'::jsonb,
  gst_details jsonb,
  created_at timestamptz not null default now()
);

create table siringetbase.escrow_holds (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null,          -- opaque reference, see note above
  vertical text not null,
  amount numeric(12, 2) not null,
  status text not null default 'held' check (status in ('held', 'released', 'reversed')),
  held_at timestamptz not null default now(),
  released_at timestamptz,
  reversed_at timestamptz
);

create table siringetbase.commission_ledger (
  id uuid primary key default gen_random_uuid(),
  escrow_hold_id uuid not null references siringetbase.escrow_holds(id),
  vertical text not null,
  service_provider_role_profile_id uuid not null references siringetbase.role_profiles(id),
  commission_rate numeric(5, 4) not null,   -- e.g. 0.1000 = 10%
  commission_amount numeric(12, 2) not null,
  net_payout_amount numeric(12, 2) not null,
  created_at timestamptz not null default now()
);

-- A ServiceProvider's registered payout bank account. Never stores a full
-- account number — see ../../security/README.md Tier 2; only the last 4
-- digits are kept for display, the real number lives with whichever real
-- bank/payout adapter eventually needs it, not in this table.
create table siringetbase.payout_accounts (
  id uuid primary key default gen_random_uuid(),
  role_profile_id uuid not null references siringetbase.role_profiles(id),
  account_holder_name text not null,
  account_number_last4 text not null,
  bank_name text not null,
  ifsc text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

-- Raw request/response log per gateway or bank call — the audit trail that
-- makes reconciliation possible once a mock is swapped for a real adapter.
create table siringetbase.provider_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references siringetbase.payments(id),
  escrow_hold_id uuid references siringetbase.escrow_holds(id),
  provider text not null,               -- e.g. 'razorpay-mock', 'icici-mock'
  provider_transaction_id text not null,
  request_snapshot jsonb not null,
  response_snapshot jsonb not null,
  status text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- Phase 0 posture: an entity sees only records it's party to. Tier 3/4
-- peer-confidentiality refinements (../../security/README.md) layer on top
-- of this baseline once a vertical's own tables exist to apply them to.
-- ---------------------------------------------------------------------------

alter table siringetbase.businesses enable row level security;
alter table siringetbase.role_profiles enable row level security;
alter table siringetbase.entity_sync_queue enable row level security;
alter table siringetbase.payments enable row level security;
alter table siringetbase.invoices enable row level security;
alter table siringetbase.escrow_holds enable row level security;
alter table siringetbase.commission_ledger enable row level security;
alter table siringetbase.payout_accounts enable row level security;
alter table siringetbase.provider_transactions enable row level security;

create policy "owner can read own business" on siringetbase.businesses
  for select using (owner_user_id = auth.uid());

create policy "owner can read own role_profiles" on siringetbase.role_profiles
  for select using (
    user_id = auth.uid()
    or business_id in (select id from siringetbase.businesses where owner_user_id = auth.uid())
  );

-- entity_sync_queue: no end-user policy at all — drained only by the
-- service-role sync job. Deliberately no `for select using (...)` clause,
-- so RLS defaults to deny-all for anon/authenticated roles.

create policy "payer can read own payments" on siringetbase.payments
  for select using (
    role_profile_id in (
      select id from siringetbase.role_profiles
      where user_id = auth.uid()
         or business_id in (select id from siringetbase.businesses where owner_user_id = auth.uid())
    )
  );

create policy "payer can read own invoices" on siringetbase.invoices
  for select using (
    payment_id in (
      select id from siringetbase.payments where role_profile_id in (
        select id from siringetbase.role_profiles
        where user_id = auth.uid()
           or business_id in (select id from siringetbase.businesses where owner_user_id = auth.uid())
      )
    )
  );

create policy "service provider can read own commission entries" on siringetbase.commission_ledger
  for select using (
    service_provider_role_profile_id in (
      select id from siringetbase.role_profiles where user_id = auth.uid()
    )
  );

create policy "owner can read own payout account" on siringetbase.payout_accounts
  for select using (
    role_profile_id in (select id from siringetbase.role_profiles where user_id = auth.uid())
  );

-- escrow_holds and provider_transactions: no direct end-user policy yet —
-- both are keyed by opaque engagement_id, not role_profile_id, so scoping
-- them correctly needs the vertical's own engagements table to join
-- against. Service-role only until a vertical schema exists to extend this.

-- ---------------------------------------------------------------------------
-- Grants — mirrors homeai's pattern: a custom schema needs explicit grants,
-- and PostgREST needs it added to "Exposed schemas" in the dashboard (see
-- README.md's setup section) before any of this is reachable from the API.
-- ---------------------------------------------------------------------------

grant usage on schema siringetbase to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema siringetbase to authenticated;
grant select on all tables in schema siringetbase to anon;
grant all on all tables in schema siringetbase to service_role;
grant usage, select on all sequences in schema siringetbase to authenticated, service_role;
