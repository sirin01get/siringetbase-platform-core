-- notification_dispatch — the shared send log backing siringetbase/comms
-- (../../comms/README.md's Data Model section). One row per send attempt,
-- any channel, any vertical, any role. Generic siringetbase infrastructure,
-- same reasoning as entity_sync_queue and referrals: cross-vertical, not
-- owned by any one vertical.
--
-- Two write paths converge here (see comms/README.md's "Two Entry Points,
-- One Pipeline"): the Send Email Hook route (auth-lifecycle email) and
-- sendNotification() (everything else). Both go through the same
-- template registry + EmailSenderPort, and both log here.
--
-- Idempotent — safe to re-run.

create table if not exists siringetbase.notification_dispatch (
  id uuid primary key default gen_random_uuid(),
  vertical text not null,
  role text not null,
  -- 'email' only today — 'sms'/'in_app' reserved, not designed yet (see
  -- comms/README.md's Data Model note on message_threads being out of
  -- scope for this pass).
  channel text not null default 'email' check (channel in ('email', 'sms', 'in_app')),
  trigger_event text not null,
  recipient_email text not null,
  -- Nullable: a marketer-invite send targets an email address that isn't
  -- a role_profile yet. Same "known up front or backfilled" shape as
  -- referrals.referee_role_profile_id.
  recipient_role_profile_id uuid references siringetbase.role_profiles(id),
  provider text not null,
  -- Nullable until the provider call returns — a row is inserted as
  -- 'queued' before the send attempt so a crash between insert and send
  -- still leaves an auditable trace, not a silent gap.
  provider_message_id text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'bounced', 'failed', 'complained')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_dispatch_recipient_role_profile_id_idx
  on siringetbase.notification_dispatch(recipient_role_profile_id);
create index if not exists notification_dispatch_vertical_role_trigger_idx
  on siringetbase.notification_dispatch(vertical, role, trigger_event);
create index if not exists notification_dispatch_status_idx
  on siringetbase.notification_dispatch(status);
create index if not exists notification_dispatch_provider_message_id_idx
  on siringetbase.notification_dispatch(provider_message_id)
  where provider_message_id is not null;

create or replace function siringetbase.set_notification_dispatch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notification_dispatch_set_updated_at on siringetbase.notification_dispatch;
create trigger notification_dispatch_set_updated_at
  before update on siringetbase.notification_dispatch
  for each row execute function siringetbase.set_notification_dispatch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- No end-user select/insert/update policy — every write comes from the
-- Send Email Hook route or sendNotification(), both running with the
-- service-role client (see ../../comms/README.md's Guardrails: signature
-- verification happens before anything is trusted, and nothing about a
-- delivery log needs to be end-user-readable today). Same posture as
-- entity_sync_queue: service-role only, revisit if a "delivery history"
-- admin view ever needs authenticated read access.
-- ---------------------------------------------------------------------------

alter table siringetbase.notification_dispatch enable row level security;

grant all on siringetbase.notification_dispatch to service_role;
