-- Referrals — the "Siringet Referred" trust badge and the ledger behind it.
-- Design: ../../referrals/README.md. Generic siringetbase infrastructure
-- (works for any vertical/role), same reasoning as entity_sync_queue and
-- the Document Intelligence skeleton — lives in this schema, not a
-- vertical's own.
--
-- Three referral_type values, one shared table, matching the pattern
-- established for entity_sync_queue.entity_type and
-- activity_events.event_type (a type discriminator, not three near-duplicate
-- tables):
--   'peer_join'         — an existing user vouches for someone (any role)
--                          registering, on explicit request. Both parties
--                          known up front; referrer must approve.
--   'marketer_invite'    — Siringet staff invites someone by email to join
--                          as a ServiceProvider. referee_role_profile_id is
--                          null until they register via the invite link.
--                          referrer_role_profile_id is nullable too — no
--                          real staff-auth/marketer-role UI exists yet
--                          (../../admin/README.md is unbuilt), so this
--                          stays honestly unattributed until that exists,
--                          rather than faking a marketer identity.
--   'client_endorsement' — a client with a COMPLETED engagement refers that
--                          provider to others. Eligibility is checked
--                          against the vertical's own engagements table at
--                          referral-creation time (see
--                          cafocus/app/src/lib/referrals/service.ts) — this
--                          migration only stores the result, it can't
--                          enforce that check itself (the engagements table
--                          is vertical-owned, not siringetbase's).
--
-- Idempotent throughout — safe to re-run.

create table if not exists siringetbase.referrals (
  id uuid primary key default gen_random_uuid(),
  referral_type text not null check (referral_type in ('peer_join', 'marketer_invite', 'client_endorsement')),
  vertical text not null,
  referrer_role_profile_id uuid references siringetbase.role_profiles(id),
  referee_role_profile_id uuid references siringetbase.role_profiles(id),
  -- Email-first reconciliation, same shape as entity_sync_queue's payload
  -- pattern: known up front for marketer_invite, backfilled into
  -- referee_role_profile_id once the invitee actually registers (see
  -- redeemInviteToken() in cafocus/app's referral service).
  referee_email text,
  referee_intended_vertical text,
  referee_intended_role text,
  -- Opaque reference into a vertical's own engagements table
  -- (client_endorsement only) — same "opaque reference, not a real FK"
  -- pattern siringetbase.payments.engagement_id already uses, since a
  -- vertical's engagements table lives in that vertical's own schema.
  source_engagement_id uuid,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  invite_token text unique,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint referrals_referrer_required_unless_marketer check (
    referral_type = 'marketer_invite' or referrer_role_profile_id is not null
  ),
  constraint referrals_referee_known_or_email check (
    referee_role_profile_id is not null or referee_email is not null
  ),
  constraint referrals_no_self_referral check (
    referrer_role_profile_id is null
    or referee_role_profile_id is null
    or referrer_role_profile_id <> referee_role_profile_id
  )
);

create index if not exists referrals_referee_role_profile_id_idx on siringetbase.referrals(referee_role_profile_id);
create index if not exists referrals_referrer_role_profile_id_idx on siringetbase.referrals(referrer_role_profile_id);
create index if not exists referrals_invite_token_idx on siringetbase.referrals(invite_token) where invite_token is not null;

-- "One referrals row per (referrer, referee) pair" — see README's Guardrails.
-- Repeat action from the same referrer reuses the existing row (peer_join:
-- re-requesting a declined referral from the same person is still blocked
-- here deliberately, ask someone else instead; client_endorsement: repeat
-- endorsement just adds referral_broadcasts rows to the existing referral).
create unique index if not exists referrals_peer_join_unique
  on siringetbase.referrals(referrer_role_profile_id, referee_role_profile_id)
  where referral_type = 'peer_join';

create unique index if not exists referrals_client_endorsement_unique
  on siringetbase.referrals(referrer_role_profile_id, referee_role_profile_id)
  where referral_type = 'client_endorsement';

-- client_endorsement fan-out — see README's Model section. One row per
-- person a client told about a provider; the referrals row itself stays
-- singular per (client, provider) pair.
create table if not exists siringetbase.referral_broadcasts (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references siringetbase.referrals(id),
  recipient_role_profile_id uuid references siringetbase.role_profiles(id),
  recipient_email text,
  sent_at timestamptz not null default now(),
  -- Backfilled if recipient_email later registers — lead-gen attribution,
  -- see README's "Consumed By" section.
  registered_role_profile_id uuid references siringetbase.role_profiles(id),
  constraint referral_broadcasts_recipient_known_or_email check (
    recipient_role_profile_id is not null or recipient_email is not null
  )
);

create index if not exists referral_broadcasts_referral_id_idx on siringetbase.referral_broadcasts(referral_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- No end-user insert/update policy on either table — every write goes
-- through a service-role route that's already checked eligibility
-- (session auth for peer_join/client_endorsement, invite-token possession
-- for marketer_invite redemption). Same posture as siringetbase.role_profiles
-- and siringetbase.documents, which cafocus/app already writes to this way
-- — see cafocus/app/src/lib/supabase/siringetbase-admin.ts.
-- ---------------------------------------------------------------------------

alter table siringetbase.referrals enable row level security;
alter table siringetbase.referral_broadcasts enable row level security;

drop policy if exists "party can read own referrals" on siringetbase.referrals;
create policy "party can read own referrals" on siringetbase.referrals
  for select using (
    referrer_role_profile_id in (select id from siringetbase.role_profiles where user_id = auth.uid())
    or referee_role_profile_id in (select id from siringetbase.role_profiles where user_id = auth.uid())
  );

-- referral_broadcasts: no end-user select policy — a recipient shouldn't
-- see who else a client told about a provider (privacy, see README's
-- Guardrails), and a client reads their own sends through the referrals
-- API rather than this table directly. Service-role only for now.

grant select on siringetbase.referrals to authenticated;
grant select on siringetbase.referral_broadcasts to authenticated;
grant all on siringetbase.referrals to service_role;
grant all on siringetbase.referral_broadcasts to service_role;
