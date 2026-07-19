-- Billing — the rate card. ../../billing/README.md's Model table describes
-- this generically as `revenue_share_rates` (percentage, deducted at
-- payout) and `subscription_plans` (recurring platform-access fee); this
-- migration builds the first real, effective-dated version of both,
-- product-named per this build's own terminology:
--   - "Platform charges"        -> platform_charge_rates    (percentage)
--   - "platform membership fee" -> platform_membership_fees (fixed, recurring)
--
-- Both are effective-dated, not just "the current rate" — an admin can
-- schedule a rate to take effect on a future date without touching
-- whatever's live today. Managed by /admin/billing (app/api/admin/billing/*
-- routes) here in platform-core, not per-vertical: per the billing doc's
-- "Consumed By: every vertical" framing, one control plane, read by every
-- vertical's own payout flow (see cafocus/app's
-- src/lib/billing/rate-card.ts, which reads these tables directly via its
-- existing siringetbase-schema service-role client — same pattern as
-- payout_accounts, no new cross-Worker endpoint needed for the READ side).
--
-- Idempotent — safe to re-run (every statement is if-not-exists).

-- ---------------------------------------------------------------------------
-- platform_charge_rates — "Platform charges": the percentage cut taken at
-- payout (release()) from a :ServiceProvider's earnings. Implements
-- ../../billing/README.md's revenue_share_rates entry under this build's
-- product terminology.
--
-- Scoping: (vertical, service_type_slug) — service_type_slug NULL means
-- "applies to every service type in this vertical unless a more specific
-- row exists" (a fallback tier, not a wildcard that always wins — see
-- rate-card.ts's lookup precedence).
--
-- No overlap CONSTRAINT is enforced at the database level (effective-dated
-- ranges with a nullable open end don't fit a simple check constraint
-- cleanly) — createPlatformChargeRate() in rate-card.ts closes out the
-- previous open-ended row for the same scope before inserting a new one,
-- application-side. A malformed direct INSERT could in principle create
-- overlapping rows; the lookup function always takes the most-recently-
-- effective matching row, so an overlap degrades to "the newer one wins",
-- not an error — flagged, not hardened further, since only the admin
-- control plane writes here today.
-- ---------------------------------------------------------------------------

create table if not exists siringetbase.platform_charge_rates (
  id uuid primary key default gen_random_uuid(),
  vertical text not null,
  service_type_slug text,
  rate numeric(5, 4) not null check (rate >= 0 and rate <= 1),
  effective_from timestamptz not null,
  effective_to timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint platform_charge_rates_effective_range check (effective_to is null or effective_to > effective_from)
);

create index if not exists platform_charge_rates_scope_idx
  on siringetbase.platform_charge_rates(vertical, service_type_slug, effective_from);

-- ---------------------------------------------------------------------------
-- platform_membership_fees — "platform membership fee": a fixed, recurring
-- platform-access fee. Implements ../../billing/README.md's
-- subscription_plans entry (the Business/ServiceProvider-tier "base
-- platform-access fee" it describes) under this build's product
-- terminology. Modeled and manageable via the same control plane as
-- platform_charge_rates; NOT yet wired to an active recurring-billing job
-- that actually collects it — see cafocus/app README's note on what this
-- slice does and doesn't cover.
--
-- Scoping: (vertical, role) — e.g. ('cafocus', 'ca'). Same effective-dating
-- and close-previous-row-on-insert posture as platform_charge_rates above.
-- ---------------------------------------------------------------------------

create table if not exists siringetbase.platform_membership_fees (
  id uuid primary key default gen_random_uuid(),
  vertical text not null,
  role text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  billing_cycle text not null check (billing_cycle in ('monthly', 'quarterly', 'annual')),
  effective_from timestamptz not null,
  effective_to timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint platform_membership_fees_effective_range check (effective_to is null or effective_to > effective_from)
);

create index if not exists platform_membership_fees_scope_idx
  on siringetbase.platform_membership_fees(vertical, role, effective_from);

-- ---------------------------------------------------------------------------
-- Row-Level Security — service_role manages both (the admin control plane
-- uses the service-role client, same as every other admin route in this
-- build); authenticated read access mirrors cafocus's
-- 0005_service_catalog.sql forward-looking read policy, so a vertical could
-- in principle read these with a user-scoped client later without a schema
-- change, even though every reader today uses a service-role client.
-- ---------------------------------------------------------------------------

alter table siringetbase.platform_charge_rates enable row level security;
alter table siringetbase.platform_membership_fees enable row level security;

drop policy if exists "authenticated can read platform charge rates" on siringetbase.platform_charge_rates;
create policy "authenticated can read platform charge rates" on siringetbase.platform_charge_rates
  for select using (auth.role() = 'authenticated');

drop policy if exists "authenticated can read platform membership fees" on siringetbase.platform_membership_fees;
create policy "authenticated can read platform membership fees" on siringetbase.platform_membership_fees
  for select using (auth.role() = 'authenticated');

grant select on siringetbase.platform_charge_rates, siringetbase.platform_membership_fees to authenticated;
grant all on siringetbase.platform_charge_rates, siringetbase.platform_membership_fees to service_role;
