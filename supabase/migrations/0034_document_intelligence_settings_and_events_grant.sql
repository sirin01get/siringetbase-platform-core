-- Fixes a gap in both 0032_extraction_events.sql and
-- 0033_document_intelligence_settings.sql: each enabled row level security
-- with no policies, on the same mistaken assumption 0016_blocked_emails.sql
-- made before it — that RLS bypass for service_role also implies a
-- table-level GRANT. It doesn't. See 0018_blocked_emails_grant.sql's own
-- header comment for the first time this exact bug was hit and fixed in
-- this codebase; this migration is the same fix applied to two more
-- tables. Confirmed live in production: GET
-- /api/admin/document-intelligence/settings returned "permission denied
-- for table document_intelligence_settings" from
-- createSupabaseServiceRoleClient() (the service-role key) even though the
-- table was visible in PostgREST's schema cache. extraction_events never
-- surfaced an equivalent visible error because
-- writeExtractionCompletedEvent() (src/lib/document-intelligence/events.ts)
-- deliberately swallows its own write failures (by design — a broken event
-- row should never retroactively fail an otherwise-successful extraction)
-- — so this same bug has been silently dropping every extraction.completed
-- event since 0032 first shipped, with no error anywhere to notice it by.
--
-- Wrapped in to_regclass() existence checks — this repo's migrations turned
-- out NOT to have been applied strictly in order against the live database
-- (0033 had run, granting its own table fine via a later attempt, but 0032
-- itself had not, so a plain `grant ... on siringetbase.extraction_events`
-- here would fail outright with "relation does not exist" rather than the
-- permission error it's meant to fix). Making this migration tolerant of
-- that instead of assuming a clean, in-order history — a grant on a table
-- that isn't there yet is simply skipped, not an error, and takes effect
-- retroactively for nothing since there's nothing to grant on; re-running
-- this file after 0032 finally does apply grants it correctly.
do $$
begin
  if to_regclass('siringetbase.extraction_events') is not null then
    execute 'grant all on siringetbase.extraction_events to service_role';
  end if;
  if to_regclass('siringetbase.document_intelligence_settings') is not null then
    execute 'grant all on siringetbase.document_intelligence_settings to service_role';
  end if;
end $$;
