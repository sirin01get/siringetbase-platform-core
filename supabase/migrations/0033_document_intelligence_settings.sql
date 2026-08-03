-- Runtime-switchable "which provider should extraction actually use"
-- setting, requested directly by the owner for A/B performance-comparison
-- testing between Workers AI (default), OpenAI, and Gemini — see
-- ../../document-intelligence/PERFORMANCE_STRATEGY.md's Phase 4 (item 10)
-- for the fallback chain this sits alongside. That fallback chain only
-- ever engages OpenAI/Gemini reactively, when Workers AI has already
-- failed (or the circuit breaker in extract.ts judged it likely to) —
-- there was previously no way to deliberately route a fresh extraction
-- through a specific provider to compare its output/latency/quality
-- head-to-head, short of editing code and redeploying.
--
-- A single mutable row, not an env var: an env var (like
-- OPENAI_API_KEY/GEMINI_API_KEY in src/config/env.ts) requires a Cloudflare
-- Pages redeploy to change, which defeats the point of a quick A/B
-- toggle — this is meant to be flipped from the admin UI (or an admin API
-- call) in seconds, not a deploy-time config decision. Same reasoning
-- separates this from extraction_templates.max_tokens, which IS
-- per-template config baked into a template row rather than a global
-- runtime toggle.
--
-- Deliberately a single row (id fixed to a constant), not a key-value
-- table — there is exactly one setting here today. If a second
-- runtime-switchable knob shows up later, widen this table then rather
-- than guessing its shape now.
create table if not exists siringetbase.document_intelligence_settings (
  id text primary key default 'default',
  primary_provider text not null default 'workers_ai'
    check (primary_provider in ('workers_ai', 'openai', 'gemini')),
  updated_at timestamptz not null default now(),
  updated_by uuid references siringetbase.role_profiles(id)
);

comment on column siringetbase.document_intelligence_settings.primary_provider is
  'Which provider extract.ts routes a FRESH extraction to first. "workers_ai" (the default) is today''s original behavior unchanged — Workers AI first, OpenAI/Gemini only as a reactive fallback on failure (see model-gateway.ts''s runFallbackExtraction()). Setting this to "openai" or "gemini" instead skips Workers AI (and its circuit breaker) entirely for any content type that provider supports natively (PDF + raster images — see model-gateway.ts''s isFallbackSupportedContentType()) and calls that provider directly as the primary attempt, with NO further fallback if it fails — an explicit provider choice for comparison testing should surface that provider''s own real failure, not silently paper over it with another one.';

-- Seed the single row so a read never has to special-case "no row yet" —
-- same idempotent-seed pattern as other single-row/small config tables in
-- this codebase.
insert into siringetbase.document_intelligence_settings (id, primary_provider)
values ('default', 'workers_ai')
on conflict (id) do nothing;

alter table siringetbase.document_intelligence_settings enable row level security;
