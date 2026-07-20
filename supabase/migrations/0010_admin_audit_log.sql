-- Real admin identity + audit trail — this app's admin surfaces (this
-- file's admin_audit_log, consumed by cafocus/app's and this app's own
-- /admin/* pages) had NO auth at all until now: shared across every
-- vertical because role_profiles itself is shared, per 0001_init.sql's
-- comment already anticipating a role: 'admin' value that nothing ever
-- built. Prompted by a real report: cafocus.siringet.com/admin/ca-verifications
-- was reachable by anyone with the URL, and the owner asked for individual
-- accountability, not just a locked door.
--
-- Two roles, not one generic 'admin' — named for what they actually do,
-- per the owner's own words: "business admin" handles CA verification and
-- platform charges (cafocus's /admin/ca-verifications, /admin/referrals,
-- this app's /admin/billing); "support admin" handles the operational/
-- queue side (cafocus's /admin/disputes, this app's /admin/sync-queue).
-- Both are role_profiles rows: vertical 'siringetbase' (platform staff,
-- not scoped to one vertical's customers), role 'business_admin' or
-- 'support_admin', status 'active'. No self-registration — provisioned
-- directly (see each app's README "Access control" section for the exact
-- insert), the same one-time-bootstrap posture as any break-glass account.

create table if not exists siringetbase.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: a denied/failed attempt by someone who turned out not to be
  -- an admin (wrong role, or not signed in at all) is still worth logging,
  -- and won't always resolve to a role_profile row.
  actor_role_profile_id uuid references siringetbase.role_profiles(id),
  actor_user_id uuid references auth.users(id),
  -- Denormalized — role_profiles carries no email, and a fired admin's
  -- auth.users row can outlive their role_profile (status flipped, not
  -- deleted); this keeps old entries readable without a join that might
  -- come back empty.
  actor_email text,
  actor_role text,
  app text not null,                    -- 'cafocus' | 'platform-core' — which deployment logged this
  action text not null,                 -- e.g. 'ca_verification.approve', 'dispute.resolve', 'billing.rate_created'
  target_type text,                     -- e.g. 'role_profile', 'engagement', 'platform_charge_rate'
  target_id text,
  outcome text not null check (outcome in ('success', 'denied', 'error')),
  -- Free-form per action: decision + reason, resolution + note, old/new
  -- rate values, whatever's meaningful for that action — deliberately not
  -- normalized into columns per action type, there'd be dozens of mostly-
  -- null columns otherwise.
  detail jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_actor_idx on siringetbase.admin_audit_log(actor_role_profile_id, created_at desc);
create index if not exists admin_audit_log_action_idx on siringetbase.admin_audit_log(action, created_at desc);
create index if not exists admin_audit_log_created_at_idx on siringetbase.admin_audit_log(created_at desc);

alter table siringetbase.admin_audit_log enable row level security;

-- Append-only, admin-eyes-only, no end-user policy at all — unlike most
-- other tables in this schema, there's no "party can read their own row"
-- case here (a client whose requirement/dispute an admin acted on has no
-- business reading *why* an admin acted, that's staff-internal). Reads and
-- writes both go through the service-role client from either app's own
-- src/lib/admin/audit.ts, same as every other cross-schema write in this
-- build — no policy is granted to `authenticated` at all, intentionally.
grant all on siringetbase.admin_audit_log to service_role;
