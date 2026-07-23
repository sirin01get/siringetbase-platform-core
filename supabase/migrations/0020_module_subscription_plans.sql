-- Recurring subscription billing — the admin-managed plan side.
-- ../../billing/README.md's `subscription_plans` entry, but per-module
-- rather than a single flat platform-membership fee: cafocus/app's
-- "Client management" / "Document storage" / "Automated reminders" service
-- types are subscription-monetized (as opposed to GST/ITR/TDS/Audit, which
-- stay on the existing revenue-share escrow flow — see
-- cafocus/app's supabase/migrations/00XX_service_types.sql for the
-- monetization_model column that tells the two apart).
--
-- Same effective-dated, close-previous-row-on-insert posture as
-- platform_charge_rates/platform_membership_fees (0008_billing_rate_cards.sql)
-- — see that migration's header comment for why no DB-level no-overlap
-- constraint is enforced. Scoping is (vertical, service_type_slug, tier):
-- a service type can have more than one tier (Basic/Pro/...), each
-- independently effective-dated, so an admin can reprice one tier without
-- touching another.
--
-- included_usage_quota + overage_unit_rate implement the "cost-plus if
-- usage is high" half of the owner's brief — nullable because not every
-- module needs a usage dimension (a flat monthly fee just leaves both
-- null). Whether/how usage is actually metered per module is intentionally
-- left to the consuming vertical (cafocus/app) — this table only holds the
-- rate an admin has decided on.
--
-- Idempotent — safe to re-run.

create table if not exists siringetbase.module_subscription_plans (
  id uuid primary key default gen_random_uuid(),
  vertical text not null,
  service_type_slug text not null,
  tier text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  included_usage_quota integer check (included_usage_quota is null or included_usage_quota >= 0),
  overage_unit_rate numeric(12, 4) check (overage_unit_rate is null or overage_unit_rate >= 0),
  usage_unit_label text,
  effective_from timestamptz not null,
  effective_to timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint module_subscription_plans_effective_range check (effective_to is null or effective_to > effective_from)
);

create index if not exists module_subscription_plans_scope_idx
  on siringetbase.module_subscription_plans(vertical, service_type_slug, tier, effective_from);

alter table siringetbase.module_subscription_plans enable row level security;

drop policy if exists "authenticated can read module subscription plans" on siringetbase.module_subscription_plans;
create policy "authenticated can read module subscription plans" on siringetbase.module_subscription_plans
  for select using (auth.role() = 'authenticated');

grant select on siringetbase.module_subscription_plans to authenticated;
grant all on siringetbase.module_subscription_plans to service_role;

-- ---------------------------------------------------------------------------
-- payment_mandates — a recurring auto-debit authorization
-- (PaymentGatewayPort.createMandate(), see src/lib/payments/types.ts). One
-- row per CA who opts into "Auto-renew" on a module subscription
-- (cafocus.ca_module_subscriptions.mandate_reference points back here by
-- value, not FK — same "opaque reference into a vertical's own schema"
-- posture payments.engagement_id already uses, since ca_module_subscriptions
-- lives in cafocus's own Postgres project, not this one).
-- ---------------------------------------------------------------------------

create table if not exists siringetbase.payment_mandates (
  id uuid primary key default gen_random_uuid(),
  role_profile_id uuid not null references siringetbase.role_profiles(id),
  vertical text not null,
  provider text not null,
  mandate_reference text not null,
  status text not null default 'active' check (status in ('active', 'failed', 'pending', 'cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists payment_mandates_role_profile_id_idx
  on siringetbase.payment_mandates(role_profile_id);

alter table siringetbase.payment_mandates enable row level security;

grant all on siringetbase.payment_mandates to service_role;

-- ---------------------------------------------------------------------------
-- payments.type gains 'subscription_charge' — a recurring module-subscription
-- draw (either against a mandate, or a manual pay-monthly charge) is
-- collection-shaped (money coming in) but distinct enough from a one-time
-- engagement 'collection' to name separately in reporting/reconciliation.
-- engagement_id already being nullable on this table (0001_init.sql) means
-- no schema change is needed there — a subscription charge simply leaves it
-- null.
-- ---------------------------------------------------------------------------

alter table siringetbase.payments drop constraint if exists payments_type_check;
alter table siringetbase.payments add constraint payments_type_check
  check (type in ('collection', 'payout', 'refund', 'subscription_charge'));
