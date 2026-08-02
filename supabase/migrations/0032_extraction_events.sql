-- Phase 5 item 12 of ../../document-intelligence/PERFORMANCE_STRATEGY.md:
-- "Build the emit(extraction.completed) event step the README already
-- documents as designed-but-not-built."
--
-- An in-memory pub/sub (register a listener function, call it when
-- extraction finishes) does NOT work on Cloudflare Workers the way it
-- would in a long-running Node process: every request runs in its own
-- isolate, so a listener registered during one request is gone by the time
-- a later request's extraction actually completes — there is no shared
-- process to hold that registration. A durable outbox table is the
-- serverless-appropriate shape instead, same idiom this codebase already
-- uses for comparable problems (siringetbase.notification_dispatch for
-- comms, siringetbase.admin_audit_log, extraction_templates_versions) —
-- insert-only, polled/consumed later rather than pushed synchronously.
--
-- This is genuinely "the emit step," not a placeholder: every completed
-- extraction gets a real, durable, queryable row the moment it finishes
-- (src/lib/document-intelligence/extract.ts's extractDocument()), and
-- GET /api/admin/document-intelligence/events (business_admin) is a real
-- consumer-facing read + mark-consumed API over it. What's still NOT
-- built, honestly: an actual automated subscriber (e.g. cafocus's
-- gst-filing-prep skill auto-pulling a finished extraction into a draft
-- reconciliation) — the README's own "Not built" banner already flags
-- that as future scope, and this migration doesn't change that. What it
-- does close is the actual gap blocking a future consumer: before this,
-- there was nowhere to even LOOK for "which extractions finished since I
-- last checked" — every completed extraction just vanished into
-- extraction_jobs with nothing marking it as newly-available.
create table if not exists siringetbase.extraction_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references siringetbase.extraction_jobs(id),
  document_id uuid not null references siringetbase.documents(id),
  vertical text not null,
  document_type text not null,
  -- Single value today ('extraction.completed' — see the README's Pipeline
  -- (Generic) step 4) but kept as a real column with a check constraint
  -- rather than an implicit assumption, so a second event type later
  -- (e.g. 'extraction.needs_review') doesn't need a schema change, only a
  -- widened check.
  event_type text not null default 'extraction.completed'
    check (event_type in ('extraction.completed')),
  -- document_id/document_type/vertical are denormalized onto this row
  -- (also derivable via job_id -> extraction_jobs -> documents) so a
  -- consumer can filter/route without an extra join on every poll — this
  -- table's whole point is being cheap and fast to query relative to
  -- extraction_jobs, which carries much heavier raw_output/interpretation
  -- payloads.
  payload jsonb not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists extraction_events_job_id_idx on siringetbase.extraction_events(job_id);
-- Partial index on the actual hot-path query ("give me what's new since I
-- last checked") — a consumer only ever cares about unconsumed rows, and
-- this table is meant to stay small in practice (rows get marked consumed,
-- not left to accumulate) so a full-table index would be wasted overhead.
create index if not exists extraction_events_unconsumed_idx
  on siringetbase.extraction_events(created_at)
  where consumed_at is null;

alter table siringetbase.extraction_events enable row level security;
