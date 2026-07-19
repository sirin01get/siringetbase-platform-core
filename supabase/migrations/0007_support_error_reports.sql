-- support_error_reports — the shared table backing siringetbase/support-escalation
-- (../../support-escalation/README.md's Data Model section). One row per
-- filed report: an error message, an optional screenshot, and a short
-- local activity trail, from any vertical, any role. Generic siringetbase
-- infrastructure, same reasoning as notification_dispatch/referrals:
-- cross-vertical, not owned by any one vertical.
--
-- Written directly by a vertical's own backend (cafocus/app's
-- POST /api/support/error-reports today) via the same siringetbase-schema
-- service-role pattern documents/role_profiles already use — see
-- cafocus/app/src/lib/supabase/siringetbase-admin.ts. Notification to the
-- support team goes through comms' sendNotification()/POST /api/comms/notify
-- separately (see support-escalation/README.md's "Two Entry Points").
--
-- Idempotent — safe to re-run.

create table if not exists siringetbase.support_error_reports (
  id uuid primary key default gen_random_uuid(),
  vertical text not null,
  role text not null,
  -- Nullable: an anonymous visitor (not yet signed in) can still hit an
  -- error and file a report. Same nullable-identity shape
  -- user-analytics's activity_events already uses.
  reporter_role_profile_id uuid references siringetbase.role_profiles(id),
  -- Browser-local session id, always present regardless of sign-in state —
  -- lets support correlate multiple reports from the same anonymous
  -- visitor without needing an account.
  reporter_session_id text not null,
  error_message text not null,
  -- Whatever the failing component already had in state: route, an
  -- optional component/stack hint. Not parsed or classified by this
  -- subsystem (support-escalation/README.md's "What Gets Captured" table).
  error_context jsonb not null default '{}'::jsonb,
  -- The local breadcrumb trail at time of send — route changes and
  -- opted-in action labels only, never financial figures, document
  -- content, or form field values (same restriction activity_events
  -- applies to itself).
  breadcrumbs jsonb not null default '[]'::jsonb,
  -- Nullable — null if the person declined the screenshot for this
  -- report (support-escalation/README.md's Guardrails: screenshot is a
  -- per-report choice, default on, always cancelable). An R2 key, not
  -- the image itself — same private-storage posture as `documents`.
  screenshot_storage_pointer text,
  status text not null default 'new'
    check (status in ('new', 'acknowledged', 'resolved')),
  created_at timestamptz not null default now()
);

create index if not exists support_error_reports_reporter_role_profile_id_idx
  on siringetbase.support_error_reports(reporter_role_profile_id);
create index if not exists support_error_reports_vertical_role_idx
  on siringetbase.support_error_reports(vertical, role);
create index if not exists support_error_reports_status_idx
  on siringetbase.support_error_reports(status);
create index if not exists support_error_reports_created_at_idx
  on siringetbase.support_error_reports(created_at desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- No end-user select/insert/update policy — every write comes from a
-- vertical's backend using the service-role client (signed-in identity is
-- looked up server-side, never trusted from the client directly, same
-- posture as documents/role_profiles writes). Read access for the future
-- admin triage queue (support-escalation/README.md's "Admin Triage" —
-- not built yet) will need its own policy once that view exists; until
-- then, service-role only, same posture as notification_dispatch.
-- ---------------------------------------------------------------------------

alter table siringetbase.support_error_reports enable row level security;

grant all on siringetbase.support_error_reports to service_role;
