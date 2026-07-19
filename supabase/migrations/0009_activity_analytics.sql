-- Phase 5 Marketplace (CA Focus) — Slice 10: activity analytics.
-- ../../user-analytics/README.md is the design doc this migration builds
-- for real, for the first time — until now it was "planned/documented, not
-- yet built as code" (that README's own Consumed By section, and
-- ../../../cafocus/phases/phase-5-marketplace-module/README.md's
-- Dependencies list, both said so explicitly). Consent-gated per India's
-- DPDP Act — see ../../user-analytics/dpdp-act-compliance-research.md;
-- practical consequence enforced here at the schema/application level
-- (not just documented): every track() call in cafocus/app's
-- src/lib/activity-analytics/track.ts checks activity_consent before
-- writing to activity_events, and is a silent no-op if consent is
-- absent/withdrawn — never a soft default of "on."
--
-- Idempotent — safe to re-run (every statement is if-not-exists, except
-- RLS policies, which drop-then-create by a fixed name).

create table if not exists siringetbase.activity_event_types (
  event_type text primary key,
  vertical text not null,
  module text not null,
  description text not null,
  drives_product_behavior boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists siringetbase.activity_events (
  id uuid primary key default gen_random_uuid(),
  role_profile_id uuid references siringetbase.role_profiles(id),
  session_id text,
  vertical text not null,
  event_type text not null references siringetbase.activity_event_types(event_type),
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  -- At least one identity anchor is required — a fully anonymous event with
  -- neither a role_profile_id nor a session_id can't be attributed to any
  -- consent record, so it should never have been written in the first
  -- place (track() enforces this before insert; this is the DB-level
  -- backstop).
  constraint activity_events_has_identity check (role_profile_id is not null or session_id is not null)
);

create index if not exists activity_events_role_profile_id_idx on siringetbase.activity_events(role_profile_id);
create index if not exists activity_events_session_id_idx on siringetbase.activity_events(session_id);
create index if not exists activity_events_vertical_event_type_idx on siringetbase.activity_events(vertical, event_type);
create index if not exists activity_events_entity_idx on siringetbase.activity_events(entity_type, entity_id);

-- Append-only ledger, per ../../user-analytics/README.md's "Per-identity
-- consent ledger" — a grant is a new row, a withdrawal sets withdrawn_at on
-- the currently-active row rather than deleting history. check_consent()
-- (track.ts) reads the most recent row for the identity+purpose and treats
-- withdrawn_at IS NOT NULL, or no row at all, as "not consented."
create table if not exists siringetbase.activity_consent (
  id uuid primary key default gen_random_uuid(),
  role_profile_id uuid references siringetbase.role_profiles(id),
  session_id text,
  purpose text not null default 'product_ux_analytics',
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  constraint activity_consent_has_identity check (role_profile_id is not null or session_id is not null)
);

create index if not exists activity_consent_role_profile_id_idx on siringetbase.activity_consent(role_profile_id, purpose);
create index if not exists activity_consent_session_id_idx on siringetbase.activity_consent(session_id, purpose);

-- Illustrative taxonomy from ../../user-analytics/README.md's "What Gets
-- Tracked" table, seeded for real here — CA Focus (Phase 5 Marketplace)
-- domain-expert work per that README, kept intentionally small (the two
-- this slice's own code actually fires — see cafocus/app's
-- src/components/marketplace/CaDirectory.tsx — plus the other three the
-- doc named, registered so the taxonomy is honest about what a future
-- slice would wire up next, not just what's live today).
insert into siringetbase.activity_event_types (event_type, vertical, module, description, drives_product_behavior)
values
  ('filtered_ca_search', 'cafocus', 'marketplace', 'Search/filter interaction on CA discovery (which filters, in what order).', false),
  ('started_engagement_request', 'cafocus', 'marketplace', 'Began the "request a CA" flow.', false),
  ('viewed_ca_profile', 'cafocus', 'marketplace', 'An Individual or SMB viewed a specific CA''s public profile.', false),
  ('abandoned_engagement_request', 'cafocus', 'marketplace', 'Started but didn''t complete the request (no engagement created within some window).', true),
  ('viewed_service_catalog_entry', 'cafocus', 'ca', 'A CA viewed their own service catalog / practice dashboard analytics.', false)
on conflict (event_type) do nothing;

alter table siringetbase.activity_events enable row level security;
alter table siringetbase.activity_consent enable row level security;

-- Per ../../user-analytics/README.md's Data Store note: "RLS scopes a
-- user's own activity history to themselves... no admin surface gets raw
-- individual-linked event rows beyond what a specific vertical's own
-- support flow genuinely needs" — no admin read policy is added here.
drop policy if exists "party can read own activity events" on siringetbase.activity_events;
create policy "party can read own activity events" on siringetbase.activity_events
  for select using (role_profile_id in (select id from siringetbase.role_profiles where user_id = auth.uid()));

drop policy if exists "party can read own consent" on siringetbase.activity_consent;
create policy "party can read own consent" on siringetbase.activity_consent
  for select using (role_profile_id in (select id from siringetbase.role_profiles where user_id = auth.uid()));

grant select on siringetbase.activity_event_types to authenticated;
grant select, insert on siringetbase.activity_events, siringetbase.activity_consent to authenticated;
grant all on siringetbase.activity_event_types, siringetbase.activity_events, siringetbase.activity_consent to service_role;
