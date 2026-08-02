-- Root-caused fix for a real, observed failure: an AIS extraction landed
-- as "Model output wasn't valid JSON" with a raw response that was
-- genuinely readable, on-topic, and complete — NOT a truncation (ruled out
-- 0023_extraction_template_max_tokens.sql's fix already covers that), and
-- NOT a licence/terms rejection (the response was clearly a real read of
-- the actual document content). The model instead returned markdown-style
-- prose mirroring the source document's own page structure:
--
--   ### Page 2
--   Securities transaction purchase HDFC Bank Ltd 2,00,000
--   ...
--   ### Page 3
--   Disputed Transaction
--   Transaction category: Salary
--   ...
--
-- instead of the required single flat JSON object. AIS is the one
-- genuinely open-ended, multi-page template in this pipeline (see
-- model-gateway.ts's header comment and 0023's), and a multi-page AIS run
-- through convertToMarkdown() produces a long, already-page-structured
-- text blob — exactly the kind of input a smaller instruction-tuned model
-- (this pipeline runs @cf/meta/llama-3.2-11b-vision-instruct, not a large
-- frontier model) is prone to "continue the input's own formatting"
-- against, even when told up front to respond with only JSON. The
-- instruction lived once, at the very start of the prompt, before a large
-- document dump — nothing re-anchored the model on the JSON-only
-- requirement right before it actually started generating.
--
-- Two changes ship together for this:
-- 1. (this migration) The AIS template's own prompt gets a concrete
--    one-shot example of the exact compact JSON shape expected, plus an
--    explicit "combine all pages into ONE flat list, do not group or
--    label by page" instruction — directly countering the page-mirroring
--    behavior actually observed. A shown example is well-documented to
--    improve format compliance far more reliably than a schema
--    description alone, especially for a smaller model on a long,
--    multi-entry extraction task.
-- 2. (src/lib/document-intelligence/extract.ts) The instruction is now
--    also restated immediately before the document content, not just
--    once at the start — a systemic fix, since any template's long
--    document content could in principle trigger the same drift, not
--    just AIS's.
--
-- output_schema and max_tokens are UNCHANGED here — computation.ts (in
-- cafocus/app) reads transactions[].amount/.information_category/
-- .reporting_entity by those exact keys; this only strengthens how
-- reliably the model is steered into producing that same shape, not what
-- the shape is.
update siringetbase.extraction_templates
set prompt = 'This is an Indian Annual Information Statement (AIS), which may span multiple pages covering several transaction categories (interest income, dividends, mutual fund purchase/sale, salary, securities transactions, foreign remittances, etc.) and may mark individual entries as Active, Modified, or Disputed. Extract the PAN it belongs to, the financial year, and a flat list of every reported financial transaction found across ALL pages, each with its information category, reporting entity name, and amount. Combine every page into ONE flat transactions list — do not group, label, or organize your output by page.

Example of the exact response shape expected (values below are illustrative only, not from this document):
{"pan":"ABCDE1234F","financial_year":"2025-26","transactions":[{"information_category":"interest income","reporting_entity":"HDFC Bank Ltd","amount":85000},{"information_category":"dividend","reporting_entity":"ICICI Prudential MF","amount":12000}]}'
where document_type = 'ais' and vertical = 'cafocus';
