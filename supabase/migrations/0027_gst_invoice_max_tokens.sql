-- Bumps gst_sales_invoice/gst_purchase_invoice's max_tokens the same way
-- 0023_extraction_template_max_tokens.sql already bumped ais's — root-
-- caused against two real invoice PDFs tested end-to-end tonight via
-- mcp-ops's test_upload_document tool, both of which failed extraction
-- with "Model output wasn't valid JSON":
--
--   * The sales-invoice document: the model's response never contained a
--     JSON object at all — it spent its whole 2048-token budget on
--     page-by-page narration/repetition (a known degenerate-output mode
--     when a vision model runs long before reaching the actual answer)
--     and got cut off before ever emitting the requested JSON.
--   * The purchase-invoice document: the model DID reach valid JSON once,
--     inside a fenced code block, then — unprompted — started restating
--     it a second time under a "JSON output:" heading, and THAT second
--     attempt is what got truncated by the 2048-token ceiling. (extract.ts's
--     stripToJsonObject() has a separate fix, in the same commit as this
--     migration, for preferring a complete fenced block over naively
--     slicing from the first '{' to the last '}' across both attempts —
--     but neither fix alone was enough: the parser fix doesn't help the
--     sales-invoice case, and this token bump alone wouldn't stop the
--     purchase-invoice model from still splicing two answers together.)
--
-- Both invoices are among the least field-heavy templates registered (five
-- required, four optional flat fields — see 0021_extraction_templates_seed.sql)
-- so this isn't AIS's "genuinely unbounded array" case; it's the model
-- itself being verbose before/around its answer, not the schema demanding
-- more output. Matching ais's 4096 ceiling anyway, same reasoning as
-- 0023's comment: doubling the budget is cheap (Workers AI bills for
-- tokens actually generated, not the ceiling) and directly addresses an
-- observed real failure rather than a hypothetical one.
update siringetbase.extraction_templates
  set max_tokens = 4096
  where document_type in ('gst_sales_invoice', 'gst_purchase_invoice')
    and vertical = 'cafocus';
