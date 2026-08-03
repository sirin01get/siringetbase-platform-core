-- Two new pieces of shared siringetbase infrastructure, same posture as
-- support_error_reports (0007) and referrals (0005): generic, cross-vertical,
-- written directly by a vertical's own backend via the service-role client
-- (cafocus/app/src/lib/supabase/siringetbase-admin.ts), no end-user direct
-- DB access.
--
-- 1. chat_threads / chat_messages — a WhatsApp-patterned support channel for
--    every signed-in user: exactly two persistent threads per person, one to
--    Siringetbase Backoffice (business_admin/support_admin) and one to
--    Herzbeat. No peer-to-peer messaging. `role_profile_id` is the universal
--    actor id on both sides of a message — a staff account (business_admin/
--    support_admin/herzbeat) is itself a role_profiles row with
--    vertical='siringetbase', exactly like an end-user's individual/ca/
--    smb_owner role_profile (see src/lib/admin/auth.ts's getAdminRoleProfile()
--    in cafocus/app) — so chat_messages.sender_role_profile_id spans both
--    without a discriminator table, only sender_kind for quick UI styling.
--
-- 2. feature_requests — a sibling of support_error_reports, filed from the
--    same floating "Request a feature" button that reuses that flow's
--    breadcrumb-capture and screenshot-capture mechanism (see
--    cafocus/app/src/components/support/{capture.ts,ErrorReportDialog.tsx}).
--    Deliberately no dedup/occurrence-count columns like
--    support_error_reports gained in 0022 — a repeated error is the same
--    incident happening again; a repeated feature ask from a different
--    screen is a distinct data point worth keeping distinct, not merging.
--
-- Idempotent — safe to re-run.

create table if not exists siringetbase.chat_threads (
  id uuid primary key default gen_random_uuid(),
  role_profile_id uuid not null references siringetbase.role_profiles(id),
  vertical text not null,
  channel text not null check (channel in ('backoffice', 'herzbeat')),
  -- Basic WhatsApp-style unread tracking: a thread is unread-for-the-user if
  -- the newest message is newer than user_last_read_at (null = never read,
  -- i.e. unread from message 1). Same shape on the staff side. No per-message
  -- read receipts — that's more precision than a two-party support channel
  -- needs.
  user_last_read_at timestamptz,
  staff_last_read_at timestamptz,
  created_at timestamptz not null default now(),
  -- Bumped on every new message (either side) — what the staff inbox sorts
  -- by, so an old thread with a brand-new reply surfaces to the top.
  updated_at timestamptz not null default now(),
  unique (role_profile_id, channel)
);

create index if not exists chat_threads_channel_updated_at_idx
  on siringetbase.chat_threads(channel, updated_at desc);

create table if not exists siringetbase.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references siringetbase.chat_threads(id),
  sender_role_profile_id uuid not null references siringetbase.role_profiles(id),
  sender_kind text not null check (sender_kind in ('user', 'staff')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_thread_id_created_at_idx
  on siringetbase.chat_messages(thread_id, created_at);

create table if not exists siringetbase.feature_requests (
  id uuid primary key default gen_random_uuid(),
  vertical text not null,
  role text not null,
  -- Nullable/anonymous-friendly, same reasoning as
  -- support_error_reports.reporter_role_profile_id (0007) — the floating
  -- button is mounted globally, including on pages reachable before sign-in.
  requester_role_profile_id uuid references siringetbase.role_profiles(id),
  requester_session_id text not null,
  description text not null,
  context jsonb not null default '{}'::jsonb,
  breadcrumbs jsonb not null default '[]'::jsonb,
  screenshot_storage_pointer text,
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'planned', 'declined', 'shipped')),
  created_at timestamptz not null default now()
);

create index if not exists feature_requests_requester_role_profile_id_idx
  on siringetbase.feature_requests(requester_role_profile_id);
create index if not exists feature_requests_vertical_role_idx
  on siringetbase.feature_requests(vertical, role);
create index if not exists feature_requests_status_idx
  on siringetbase.feature_requests(status);
create index if not exists feature_requests_created_at_idx
  on siringetbase.feature_requests(created_at desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- Service-role only throughout, same posture as support_error_reports and
-- documents — every read and write goes through a vertical's own backend,
-- which looks up the signed-in identity server-side rather than trusting a
-- client-supplied role_profile_id. No end-user or staff policy needed since
-- neither side ever queries these tables directly from the browser.
-- ---------------------------------------------------------------------------

alter table siringetbase.chat_threads enable row level security;
alter table siringetbase.chat_messages enable row level security;
alter table siringetbase.feature_requests enable row level security;

grant all on siringetbase.chat_threads to service_role;
grant all on siringetbase.chat_messages to service_role;
grant all on siringetbase.feature_requests to service_role;
