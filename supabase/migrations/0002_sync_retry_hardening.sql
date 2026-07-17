-- Retry-with-backoff hardening for the entity_sync_queue outbox — MVP item
-- #2 in ../../entity-graph/data-sync-architecture.md §4. Additive only: does
-- not touch 0001_init.sql's tables or any existing data, safe to run against
-- a project that already has real role_profiles/entity_sync_queue rows.
--
-- Before this migration, a 'failed' row was terminal — nothing ever retried
-- it. Now a failed row goes back to 'pending' with attempts incremented and
-- next_attempt_at pushed into the future (exponential backoff, computed in
-- src/lib/entity-graph/sync.ts), until MAX_ATTEMPTS is exceeded, at which
-- point it's left in a distinct 'dead_letter' status instead of being
-- retried forever.

alter table siringetbase.entity_sync_queue
  add column attempts integer not null default 0,
  add column next_attempt_at timestamptz not null default now();

-- Drop and recreate the status check constraint to add 'dead_letter',
-- looking up whatever Postgres auto-named the original inline check on
-- 0001_init.sql's `status` column rather than hardcoding a guessed name.
do $$
declare
  existing_constraint_name text;
begin
  select conname into existing_constraint_name
  from pg_constraint
  where conrelid = 'siringetbase.entity_sync_queue'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%pending%';

  if existing_constraint_name is not null then
    execute format('alter table siringetbase.entity_sync_queue drop constraint %I', existing_constraint_name);
  end if;
end $$;

alter table siringetbase.entity_sync_queue
  add constraint entity_sync_queue_status_check
  check (status in ('pending', 'processed', 'failed', 'dead_letter'));

-- The drain query now filters on next_attempt_at too (a retried row is
-- 'pending' again but shouldn't be picked up until its backoff delay
-- elapses) — replace the old status-only partial index accordingly.
drop index if exists siringetbase.entity_sync_queue_pending_idx;
create index entity_sync_queue_pending_idx
  on siringetbase.entity_sync_queue(next_attempt_at)
  where status = 'pending';

-- Backlog-visibility support (MVP item #4) — cheap index for the
-- dead-letter count /api/diagnostics now reports.
create index entity_sync_queue_dead_letter_idx
  on siringetbase.entity_sync_queue(status)
  where status = 'dead_letter';
