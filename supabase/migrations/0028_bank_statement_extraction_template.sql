-- Registers the seventh extraction template: bank_statement. It's been a
-- valid, advertised upload type for small-business since
-- src/lib/documents/types.ts's SMB_DOCUMENT_TYPES list existed, but —
-- exactly like the six 0021_extraction_templates_seed.sql types before
-- their own migration — had no siringetbase.extraction_templates row, so
-- extract.ts's `if (!template) return { status: "skipped", ... }` branch
-- fired for every upload. Confirmed via mcp-ops's test_upload_document
-- tool: a real sample bank statement returned status "skipped" with no
-- error, exactly as documented (not a bug — see extract.ts's own comment on
-- that branch).
--
-- max_tokens set to 4096 directly here, not left at the table's 2048
-- default — same reasoning as ais's bump in 0023_extraction_template_
-- max_tokens.sql: a bank statement's transaction list is genuinely
-- unbounded (a real business account's monthly statement can run to
-- dozens of line items), not a handful of fixed fields like Form 16 or a
-- single invoice. Learned from GST invoices' own max_tokens gap
-- (0027_gst_invoice_max_tokens.sql, discovered only after a real upload
-- failed) not to leave a template with an open-ended array field at the
-- table default and wait for the same failure to repeat.
insert into siringetbase.extraction_templates
  (document_type, vertical, owning_module, prompt, output_schema, confidence_threshold, requires_human_review, max_tokens)
values
  (
    'bank_statement',
    'cafocus',
    'cafocus/small-business',
    'This is an Indian bank statement for a business account. Extract the account holder name, bank name, account number (may be masked or partial), IFSC code if present, the statement period (start and end date), the opening balance, the closing balance, and a list of every transaction shown — each with its date, description/narration, debit amount (if it is a debit), credit amount (if it is a credit), and running balance if shown. A transaction has either a debit amount or a credit amount, never both.',
    '{
      "type": "object",
      "required": ["account_holder_name", "bank_name", "account_number", "statement_period_start", "statement_period_end", "opening_balance", "closing_balance", "transactions"],
      "properties": {
        "account_holder_name": {"type": "string"},
        "bank_name": {"type": "string"},
        "account_number": {"type": "string"},
        "ifsc_code": {"type": "string"},
        "statement_period_start": {"type": "string"},
        "statement_period_end": {"type": "string"},
        "opening_balance": {"type": "number"},
        "closing_balance": {"type": "number"},
        "transactions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "date": {"type": "string"},
              "description": {"type": "string"},
              "debit_amount": {"type": "number"},
              "credit_amount": {"type": "number"},
              "balance": {"type": "number"}
            }
          }
        }
      }
    }'::jsonb,
    0.70,
    true,
    4096
  )
on conflict (document_type, vertical) do nothing;
