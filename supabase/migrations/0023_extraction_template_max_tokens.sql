-- Per-template output token ceiling — root-caused fix for a real failure:
-- an AIS document ("Model output wasn't valid JSON") failing because the
-- model's response was silently truncated. Neither runVisionModel() nor
-- runTextModel() in src/lib/document-intelligence/model-gateway.ts ever
-- set `max_tokens`, so every call used Workers AI's own default of 256
-- output tokens — plenty for the five templates that ask for a handful of
-- fixed fields, nowhere near enough for AIS's open-ended `entries` array
-- (a real AIS can have 20-50+ information categories). The model got cut
-- off mid-response, often mid-string, so even extract.ts's
-- stripToJsonObject() best-effort cleanup had no valid closing brace to
-- find.
--
-- Made a per-template column, not a single global constant, because "how
-- much output could this document type's extraction produce" is a
-- property of the DOCUMENT TYPE (AIS's open-ended entries array vs. Form
-- 16's handful of fixed fields), not of the AI provider or the pipeline
-- itself — the same reasoning app/admin/document-intelligence's `prompt`
-- and `output_schema` fields are already per-template rather than global.
-- This also happens to be the right shape if a second AI provider is ever
-- added (../../../document-intelligence/README.md's "OpenAI fallback,
-- not implemented" line) — model-gateway.ts's runVisionModel()/
-- runTextModel() take max_tokens as a plain, provider-agnostic named
-- parameter (see that file's own comment), so whichever provider is
-- actually called reads the same per-template ceiling; nothing about this
-- column is Workers-AI-specific. A raw token COUNT does depend on the
-- provider's own tokenizer (a value tuned for Llama 3.2 isn't an exact
-- match for GPT's or Claude's tokenizer), so this is a right-order-of-
-- magnitude ceiling to carry forward across providers, not a
-- byte-for-byte portable one — a real multi-provider build would still
-- want that caveat surfaced wherever the value is edited, which the admin
-- UI's field hint below does.
--
-- Default 2048 (8x Workers AI's own 256 default) — generous headroom for
-- every template's realistic output size without meaningfully changing
-- per-call cost (Workers AI's llama-3.2-11b-vision-instruct is priced per
-- token actually generated, not up to the ceiling, so a request that
-- naturally finishes in 400 tokens is still billed for ~400, not 2048).
-- ais gets a further bump to 4096 in the backfill below, specifically
-- because its schema is the one genuinely unbounded array among the six
-- registered templates.
alter table siringetbase.extraction_templates
  add column if not exists max_tokens integer not null default 2048;

update siringetbase.extraction_templates
  set max_tokens = 4096
  where document_type = 'ais' and vertical = 'cafocus';

comment on column siringetbase.extraction_templates.max_tokens is
  'Output token ceiling passed through to whichever AI provider extract.ts calls (model-gateway.ts''s runVisionModel()/runTextModel() take it as a plain named parameter, not a Workers-AI-specific option) — a per-document-type value, not a global one, since output size varies by schema (a template with an open-ended array needs much more headroom than one with a handful of fixed fields). Too low silently truncates the model''s response mid-JSON, which fails parsing even after stripToJsonObject()''s cleanup pass — this is the actual root cause a "Model output wasn''t valid JSON" failure on an AIS document traced back to (Workers AI''s own default is 256, far too low for AIS''s unbounded entries array).';
