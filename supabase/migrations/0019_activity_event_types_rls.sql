-- Fixes Supabase's security advisor warning: "Table publicly accessible...
-- Row-Level Security is not enabled" (rls_disabled_in_public) for
-- siringetbase.activity_event_types.
--
-- 0009_activity_analytics.sql enabled RLS on activity_events and
-- activity_consent (the two tables that actually hold per-person data) but
-- missed activity_event_types — a pure lookup/catalog table (event_type,
-- vertical, module, description, drives_product_behavior; seeded via
-- insert in that same migration) with no per-user data in it at all. It
-- already had `grant select on siringetbase.activity_event_types to
-- authenticated` (any signed-in user can read the catalog of event
-- types — that's the intended behavior, unchanged here), but a GRANT
-- without RLS enabled means literally no policy governs that access at
-- all, which is exactly what the advisor flags regardless of whether the
-- table's contents are sensitive.
--
-- Enabling RLS + an explicit "authenticated can read" policy makes that
-- same already-intended access explicit and policy-governed instead of
-- ungoverned, closing the warning without changing who can read what.
-- Insert/update/delete stay implicitly staff/service-role-only (no
-- policies for those, RLS default-denies anything uncovered) — same
-- posture as the seed insert in 0009 itself, which already runs as the
-- migration/service-role owner, not through this policy.
alter table siringetbase.activity_event_types enable row level security;

create policy "authenticated can read activity event types"
  on siringetbase.activity_event_types
  for select
  to authenticated
  using (true);

-- Rollback:
--   drop policy "authenticated can read activity event types" on siringetbase.activity_event_types;
--   alter table siringetbase.activity_event_types disable row level security;
