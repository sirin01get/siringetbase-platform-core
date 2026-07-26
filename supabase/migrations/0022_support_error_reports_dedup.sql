-- Adds recurrence tracking to siringetbase.support_error_reports
-- (0007_support_error_reports.sql). Owner instruction: "in case if the
-- error is same then keep the evidence and details same and just increase
-- the lines for the numbers of users affected" — filing the SAME error
-- again (see app/api/support/error-reports/route.ts's matching logic:
-- same vertical + role + error_message + error_context.page, on a report
-- still open) no longer inserts a second row with a second screenshot and
-- a second breadcrumb trail. It updates these three columns on the
-- existing row instead, leaving error_message/error_context/breadcrumbs/
-- screenshot_storage_pointer exactly as first captured — that's the
-- original evidence, and duplicating it per re-occurrence would just be
-- noise, not new information.
--
-- Idempotent — safe to re-run.

alter table siringetbase.support_error_reports
  add column if not exists occurrence_count integer not null default 1,
  add column if not exists affected_session_ids jsonb not null default '[]'::jsonb,
  add column if not exists last_seen_at timestamptz not null default now();

-- Backfill for rows written before this migration: exactly one occurrence,
-- by exactly the session that filed it, last seen when it was created.
update siringetbase.support_error_reports
set
  affected_session_ids = jsonb_build_array(reporter_session_id),
  last_seen_at = created_at
where affected_session_ids = '[]'::jsonb;

comment on column siringetbase.support_error_reports.occurrence_count is
  'Total times this same error was filed (matched by vertical+role+error_message+context.page while the report is still new/acknowledged), including the first. Not the same as affected_session_ids length when one person hits it twice.';
comment on column siringetbase.support_error_reports.affected_session_ids is
  'Distinct reporter_session_id values seen for this error while open — jsonb array length is the "how many users affected" count. Session id, not a user id, since a reporter can be anonymous (see 0007''s header comment).';
comment on column siringetbase.support_error_reports.last_seen_at is
  'Updated on every matching re-occurrence; created_at stays the first-seen time so both "how long has this been happening" and "did it just happen again" are answerable.';
