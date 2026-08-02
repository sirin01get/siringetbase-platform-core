-- Phase 1 item 3 of ../../document-intelligence/PERFORMANCE_STRATEGY.md
-- ("structured per-attempt logging") + Phase 4 item 10 (OpenAI/Gemini
-- fallback providers) — records which provider actually served a given
-- extraction attempt. Latency is deliberately NOT a new stored column:
-- extraction_jobs already has created_at/completed_at, and this migration
-- adds a durationMs figure into the existing free-form raw_output jsonb
-- instead (see src/lib/document-intelligence/extract.ts) rather than a
-- third timestamp/duration column for the same information. model_provider
-- earns a real column because it's used for filtering/grouping in reports
-- (Phase 2/5's per-template dashboard — how often does the fallback chain
-- actually get used), which a jsonb field would make slower and clumsier
-- to query than a real column with an index.
--
-- Defaults to 'workers_ai' — not nullable-with-no-default — so every
-- EXISTING row (every extraction ever run before this migration, all of
-- which used Workers AI, since no fallback provider existed yet) reads
-- correctly without a backfill UPDATE: they really were served by
-- workers_ai, so the default is also the historically correct value, not
-- just a placeholder.

alter table siringetbase.extraction_jobs
  add column if not exists model_provider text not null default 'workers_ai'
    check (model_provider in ('workers_ai', 'openai', 'gemini'));

create index if not exists extraction_jobs_model_provider_idx
  on siringetbase.extraction_jobs(model_provider);
