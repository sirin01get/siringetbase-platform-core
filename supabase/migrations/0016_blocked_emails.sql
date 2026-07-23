-- Email blocklist — the owner's admin worklist request: "give a worklist to
-- monitor how many emails have done signup and in which workflow. The
-- admin shall be able to select one email and block it for all the
-- roles." "All the roles" is why this is keyed on (email, vertical), not
-- one row per role_profile — a single block keeps someone out of every
-- cafocus role (ca, individual, smb_owner) at once. Enforced from
-- cafocus/app's src/lib/admin/signups.ts (isEmailBlocked()), called from
-- app/auth/callback/route.ts and each dashboard's server-side gate
-- (app/individual/page.tsx, app/small-business/page.tsx,
-- app/practice/page.tsx).
--
-- effective_at, not just blocked_at — the owner's second requirement:
-- "there shall be a check against existing paid subscription. right now
-- this subscription check shall pass later it shall block the user from
-- the end of the subscription date." cafocus/app's
-- src/lib/admin/subscriptions.ts's getActiveSubscriptionEndDate() always
-- returns null today (no paid-subscription system exists yet for
-- individual/smb_owner customers — platform_charge_rates/
-- platform_membership_fees in 0008_billing_rate_cards.sql are what CAs pay
-- the platform, not what end customers pay), so every block's
-- effective_at is just now() — immediate. Once a real subscription table
-- exists, that stub becomes a real lookup and a blocked *paying* customer
-- gets effective_at = their subscription's end date instead of now();
-- isEmailBlocked()'s effective_at <= now() check already honors that
-- without any schema change here.
create table siringetbase.blocked_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  vertical text not null default 'cafocus',
  status text not null default 'active' check (status in ('active', 'lifted')),
  reason text,
  effective_at timestamptz not null default now(),
  blocked_by_role_profile_id uuid references siringetbase.role_profiles(id),
  blocked_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by_role_profile_id uuid references siringetbase.role_profiles(id)
);

-- At most one *active* block per (email, vertical) at a time. Re-blocking
-- after a lift is fine (a new row) — src/lib/admin/signups.ts's
-- blockEmail() lifts any existing active row first, so this index never
-- actually gets exercised as a conflict path, just as a safety invariant.
create unique index blocked_emails_active_email_vertical_idx
  on siringetbase.blocked_emails(email, vertical)
  where status = 'active';

create index blocked_emails_email_vertical_idx
  on siringetbase.blocked_emails(email, vertical);

alter table siringetbase.blocked_emails enable row level security;
-- Deliberately no policies: anon/authenticated default-deny, service role
-- bypasses — same posture as 0012_global_directory.sql and
-- 0010_admin_audit_log.sql. Only cafocus/app's admin API routes and the
-- enforcement checks (service role) ever touch this table.

-- Rollback:
--   drop table siringetbase.blocked_emails;
