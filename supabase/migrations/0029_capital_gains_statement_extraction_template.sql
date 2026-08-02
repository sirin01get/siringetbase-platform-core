-- Registers the eighth extraction template: capital_gains_statement — an
-- individual's stock/equity-mutual-fund capital gains statement, the format
-- every Indian discount broker (Zerodha's Console "Tax P&L" report is the
-- one this template was designed and tested against, via a generated
-- sample statement) issues for ITR filing: every closed equity position
-- split into short-term (held <= 12 months, taxed under Section 111A) and
-- long-term (held > 12 months, taxed under Section 112A) buckets, each
-- individual trade's buy/sell dates and values, and the realized gain/loss.
--
-- Modeled on 0028_bank_statement_extraction_template.sql's shape (a header
-- of identity/summary fields plus one-or-more open-ended transaction
-- arrays) — same reasoning for max_tokens set to 4096 here rather than the
-- table's 2048 default: a real trader's statement can carry many rows
-- across a financial year, not a handful of fixed fields.
--
-- Deliberately does NOT ask the model to compute the actual STCG/LTCG tax
-- (20%/12.5% respectively, see cafocus/app/src/lib/itr/tax-rules.ts) — that
-- is a deterministic statutory calculation cafocus/app's own code performs
-- over the extracted transaction data (src/lib/itr/computation.ts's
-- readCapitalGains()), not something to trust a vision model's arithmetic
-- for. The model's job is only to read what the statement itself reports:
-- each trade's figures and the broker's own short-term/long-term subtotals
-- (used as a cross-check against cafocus/app's own recomputation from the
-- transaction rows, the same "reconcile the document's own total against a
-- rebuild from line items" pattern GST invoice validation already uses).
insert into siringetbase.extraction_templates
  (document_type, vertical, owning_module, prompt, output_schema, confidence_threshold, requires_human_review, max_tokens)
values
  (
    'capital_gains_statement',
    'cafocus',
    'cafocus/individual',
    'This is a capital gains statement (sometimes called a "Tax P&L" report) issued by an Indian stockbroker (e.g. Zerodha, Groww, Upstox) for equity share and equity-mutual-fund trading, used for income tax filing. Extract the broker/platform name, the account holder''s PAN if shown, the broker client ID if shown, and the financial year the statement covers. Then extract every closed (sold) position, split into two lists: short-term (holding period 12 months or less) and long-term (holding period more than 12 months) — the statement itself usually labels these sections, do not calculate holding period yourself. For each transaction in either list, extract: the stock/security symbol or name, the ISIN if shown, the quantity, the buy date, the total buy value (cost of acquisition), the sell date, the total sell value, and the realized gain or loss for that trade (this can be negative for a loss). Finally, extract the statement''s own reported short-term capital gains total and long-term capital gains total if shown (these are cross-checked against a sum of the individual transactions, not trusted blindly).',
    '{
      "type": "object",
      "required": ["broker_name", "financial_year", "short_term_transactions", "long_term_transactions"],
      "properties": {
        "broker_name": {"type": "string"},
        "pan": {"type": "string"},
        "client_id": {"type": "string"},
        "financial_year": {"type": "string"},
        "short_term_capital_gains_total": {"type": "number"},
        "long_term_capital_gains_total": {"type": "number"},
        "short_term_transactions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "symbol": {"type": "string"},
              "isin": {"type": "string"},
              "quantity": {"type": "number"},
              "buy_date": {"type": "string"},
              "buy_value": {"type": "number"},
              "sell_date": {"type": "string"},
              "sell_value": {"type": "number"},
              "realized_gain": {"type": "number"}
            }
          }
        },
        "long_term_transactions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "symbol": {"type": "string"},
              "isin": {"type": "string"},
              "quantity": {"type": "number"},
              "buy_date": {"type": "string"},
              "buy_value": {"type": "number"},
              "sell_date": {"type": "string"},
              "sell_value": {"type": "number"},
              "realized_gain": {"type": "number"}
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
