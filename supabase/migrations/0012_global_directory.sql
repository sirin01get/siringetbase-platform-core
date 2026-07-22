-- Global identity directory — GLOBAL/01 §B: "built day 1, tiny". The one
-- truly global datastore, applied only to the siringet-global instance's
-- Supabase project. Answers exactly one question — "who is this person
-- across instances?" — and holds NO content: no work orders, no payments,
-- no PII beyond the email-hash mapping (raw email stays in each regional
-- instance's auth).

create table siringetbase.global_directory (
  global_person_id uuid primary key default gen_random_uuid(),
  -- SHA-256 hex of the lowercased, trimmed email — computed by the
  -- regional instance before calling the ingest API, so raw email never
  -- crosses an instance boundary (src/lib/global-directory/hash.ts).
  email_hash text not null unique,
  home_region text not null check (home_region in ('us', 'in')),
  created_at timestamptz not null default now()
);

-- One row per (person, region) — the regional_profiles[] mapping.
create table siringetbase.global_regional_profiles (
  global_person_id uuid not null references siringetbase.global_directory(global_person_id),
  region text not null check (region in ('us', 'in', 'global')),
  local_user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (global_person_id, region)
);

-- Global roles a person has joined (Writer's Club, Training, …) with the
-- consent captured at join time (GLOBAL/01 §C: portable-profile data syncs
-- only on joining a global role, with explicit consent).
create table siringetbase.global_roles (
  global_person_id uuid not null references siringetbase.global_directory(global_person_id),
  vertical text not null,
  role text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'left')),
  consent_ref text not null,
  created_at timestamptz not null default now(),
  primary key (global_person_id, vertical, role)
);

-- RLS: deny-all for end users — the directory is written and read ONLY by
-- the signed service-to-service ingest path (GLOBAL/01 §C outbox → queue →
-- ingest API; no instance ever queries another's database directly).
alter table siringetbase.global_directory enable row level security;
alter table siringetbase.global_regional_profiles enable row level security;
alter table siringetbase.global_roles enable row level security;
-- Deliberately no policies: anon/authenticated default-deny, service role bypasses.

-- Rollback:
--   drop table siringetbase.global_roles;
--   drop table siringetbase.global_regional_profiles;
--   drop table siringetbase.global_directory;
