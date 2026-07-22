-- Numbered 0015, not 0013 — this project's Supabase database is shared
-- across cafocus/app, this repo, and PMMUSA, each with its own
-- independently-numbered supabase/migrations folder. cafocus/app's
-- migrations already claimed remote versions 0013 (client_requirements)
-- and 0014 (client_invite_offers) on this shared database, so this repo's
-- own next migration has to skip past both to avoid colliding — see
-- this repo's own README for the "supabase migration repair" reconciliation
-- this required. This repo's own migration immediately before this one is
-- 0012_global_directory.sql — nothing called 0013 or 0014 has ever
-- existed in this repo's own migrations folder; those numbers belong
-- entirely to cafocus/app's sequence on the shared database.
--
-- Document review workflow — adds the one column missing for a human
-- reviewer to confirm/correct an AI extraction, per the owner's request:
-- "add additional screen for business admin to search and review the
-- json" plus a CA-side review screen (the assigned CA is the primary
-- reviewer) and confidence-gating, on top of the extraction pipeline
-- built in 0003_document_intelligence_skeleton.sql.
--
-- siringetbase.extraction_jobs already has `interpretation` (the AI's raw
-- output), `confidence`, `reviewed_by`, and `reviewed_at` — but nothing
-- writes to the review columns yet, and there's nowhere to put a
-- reviewer's correction without overwriting the AI's original output
-- (which would destroy the audit trail of what the model actually said).
-- `corrected_interpretation` is that place: null until reviewed, and once
-- set (by cafocus/app's src/lib/documents/review.ts — a CA reviewing
-- their own client's document, or a business_admin reviewing any
-- document), it — not `interpretation` — is the trusted reading.
--
-- "Needs review" itself is NOT a stored column — it's computed at query
-- time from extraction_templates.requires_human_review /
-- confidence_threshold vs. extraction_jobs.confidence/reviewed_at (see
-- review.ts), so a future change to a template's threshold doesn't leave
-- stale rows to backfill.
--
-- Idempotent (add column if not exists), consistent with every other
-- migration in this repo.

alter table siringetbase.extraction_jobs
  add column if not exists corrected_interpretation jsonb;

comment on column siringetbase.extraction_jobs.corrected_interpretation is
  'Reviewer-confirmed/corrected reading, written by cafocus/app''s src/lib/documents/review.ts. Null until reviewed_at is set; once present, this (not interpretation) is the trusted extraction for this job.';
