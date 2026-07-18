-- Extends role_profiles.status to include 'rejected' — needed by CA Focus's
-- Phase 2 onboarding/verification flow
-- (../../../cafocus/phases/phase-2-ca-module/README.md): an admin reviewing
-- a pending_verification CA can now reject the submission explicitly,
-- distinct from 'suspended' (which implies the role was active and later
-- paused) and distinct from leaving it stuck at 'pending_verification'
-- forever with no signal to the CA that something needs fixing.
--
-- Generic here deliberately — 'rejected' is a real identity/role-profile
-- lifecycle state any vertical's verification flow can use (an architect's
-- RERA check in Build Focus, say), not CA-Focus-specific, so it belongs on
-- the shared siringetbase.role_profiles status enum rather than being
-- modeled as a cafocus-only flag.
--
-- Same idempotent constraint-swap pattern as
-- 0003_document_intelligence_skeleton.sql's entity_sync_queue.entity_type
-- extension: look up the existing check constraint by content, drop it by
-- discovered name, re-add with the new value included. Safe to re-run.

do $$
declare
  existing_constraint_name text;
begin
  select conname into existing_constraint_name
  from pg_constraint
  where conrelid = 'siringetbase.role_profiles'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%pending_verification%';

  if existing_constraint_name is not null then
    execute format('alter table siringetbase.role_profiles drop constraint %I', existing_constraint_name);
  end if;
end $$;

alter table siringetbase.role_profiles
  add constraint role_profiles_status_check
  check (status in ('active', 'pending_verification', 'suspended', 'rejected'));
