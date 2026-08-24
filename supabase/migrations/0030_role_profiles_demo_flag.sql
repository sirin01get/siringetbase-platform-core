-- Demo accounts — self-run product demo for CA Focus's three roles
-- (individual / small-business / CA), per the owner's ask: "I want a self
-- demo of their functionality... when and where shall it be available?"
--
-- Decision made with the owner: demo visitors get dropped into the SAME
-- production database real users are in (not a separate environment/
-- project) — fastest to build, reuses the existing schema and the
-- mcp-ops test-account seeding logic directly. The tradeoff that decision
-- accepts is that every admin/analytics surface must remember to exclude
-- flagged rows; this migration is what makes that a one-column, one-join
-- check instead of an email-pattern guess scattered across the codebase.
--
-- role_profiles is the single point every downstream cafocus table already
-- traces back to:
--   - siringetbase.documents.owner_role_profile_id
--   - cafocus.professional_profiles.role_profile_id
--   - cafocus.individual_profiles.role_profile_id
--   - cafocus.organizations.business_id -> siringetbase.businesses.owner_user_id
--     -> siringetbase.role_profiles.user_id (smb_owner's role_profile)
--   - engagements / filings / client_requirements — all keyed by a
--     role_profile_id on one or both sides (client + CA)
-- Flagging here, not on every child table, is enough for any admin query to
-- exclude demo data with a single join/EXISTS back to this table, rather
-- than a migration (and an easy-to-forget filter) on a dozen tables.
--
-- The 3 fixed demo identities this flag applies to (one role_profile each,
-- role='individual' | 'smb_owner' | 'ca') are created/reset by
-- cafocus/app's demo seed script — see
-- cafocus/app/scripts/seed-demo-accounts.ts's header comment for exactly
-- which fixture data each one gets.
--
-- Idempotent — safe to re-run.

alter table siringetbase.role_profiles
  add column if not exists is_demo boolean not null default false;

-- Partial index — is_demo is false for the overwhelming majority of rows
-- (every real user), so a plain index would mostly waste space; this only
-- indexes the handful of demo rows, which is exactly what "find the demo
-- accounts to reset" and "exclude demo accounts from this admin list"
-- queries need.
create index if not exists role_profiles_is_demo_idx
  on siringetbase.role_profiles(is_demo) where is_demo;
