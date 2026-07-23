-- Seeds siringetbase.extraction_templates with real rows for the six
-- document_type values cafocus/app's src/lib/documents/types.ts already
-- claims are wired ("form16/form16a/form26as/ais for individual,
-- gst_sales_invoice/gst_purchase_invoice for small-business" — see that
-- file's header comment). They were never actually seeded: 0003_document_
-- intelligence_skeleton.sql only created the table, and no migration or
-- admin action since has ever inserted a row into it. Practically, this
-- means extract.ts's `if (!template) return { status: "skipped", ... }`
-- branch has been firing for every single upload since the pipeline was
-- built — no document has ever actually been parsed by the Vision model,
-- regardless of type. This migration is the fix: real prompts + JSON
-- schemas for the six types the individual/small-business intake UIs
-- already advertise as supported.
--
-- Prompts and schemas are a first pass, not audited against real sample
-- documents — the honest MVP version of "make the six advertised document
-- types actually extract," matching this project's established "flagged,
-- not hidden" posture elsewhere. Expect these to need tuning once real
-- uploads are tested end-to-end.
--
-- requires_human_review = true on all six — every one of these feeds a tax
-- filing or a GST return, so nothing here should silently auto-populate a
-- filing without a CA's eyes on it first (src/lib/documents/review.ts's
-- confidence-gating + review/confirm flow already exists for exactly this).
--
-- on conflict (document_type, vertical) do nothing — idempotent, safe to
-- re-run, and won't clobber a row an admin has since hand-tuned via the new
-- /admin/document-intelligence page (src/lib/document-intelligence/
-- templates.ts + app/api/admin/document-intelligence/extraction-templates/
-- route.ts — no schema change needed for that, it just reads/writes this
-- same table).

insert into siringetbase.extraction_templates
  (document_type, vertical, owning_module, prompt, output_schema, confidence_threshold, requires_human_review)
values
  (
    'form16',
    'cafocus',
    'cafocus/individual',
    'This is an Indian Form 16 — a TDS certificate for salary income issued by an employer. Extract the employer name, employer TAN, employee name, employee PAN, the assessment year, gross salary, total tax deducted at source (TDS), and taxable income if stated.',
    '{
      "type": "object",
      "required": ["employer_name", "employer_tan", "employee_pan", "assessment_year", "gross_salary", "total_tds"],
      "properties": {
        "employer_name": {"type": "string"},
        "employer_tan": {"type": "string"},
        "employee_name": {"type": "string"},
        "employee_pan": {"type": "string"},
        "assessment_year": {"type": "string"},
        "gross_salary": {"type": "number"},
        "total_tds": {"type": "number"},
        "taxable_income": {"type": "number"}
      }
    }'::jsonb,
    0.75,
    true
  ),
  (
    'form16a',
    'cafocus',
    'cafocus/individual',
    'This is an Indian Form 16A — a TDS certificate for non-salary income (e.g. interest, professional fees, rent). Extract the deductor name, deductor TAN, deductee name, deductee PAN, the section code under which tax was deducted, total amount paid/credited, total TDS deducted, and assessment year.',
    '{
      "type": "object",
      "required": ["deductor_name", "deductor_tan", "deductee_pan", "total_amount_paid", "total_tds", "assessment_year"],
      "properties": {
        "deductor_name": {"type": "string"},
        "deductor_tan": {"type": "string"},
        "deductee_name": {"type": "string"},
        "deductee_pan": {"type": "string"},
        "section_code": {"type": "string"},
        "total_amount_paid": {"type": "number"},
        "total_tds": {"type": "number"},
        "assessment_year": {"type": "string"}
      }
    }'::jsonb,
    0.75,
    true
  ),
  (
    'form26as',
    'cafocus',
    'cafocus/individual',
    'This is an Indian Form 26AS — a consolidated annual tax statement. Extract the PAN it belongs to, the assessment year, and every TDS/TCS entry as a list, each with deductor name, deductor TAN, section, amount paid/credited, and tax deducted.',
    '{
      "type": "object",
      "required": ["pan", "assessment_year", "tds_entries"],
      "properties": {
        "pan": {"type": "string"},
        "assessment_year": {"type": "string"},
        "tds_entries": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "deductor_name": {"type": "string"},
              "deductor_tan": {"type": "string"},
              "section": {"type": "string"},
              "amount_paid": {"type": "number"},
              "tax_deducted": {"type": "number"}
            }
          }
        }
      }
    }'::jsonb,
    0.70,
    true
  ),
  (
    'ais',
    'cafocus',
    'cafocus/individual',
    'This is an Indian Annual Information Statement (AIS). Extract the PAN it belongs to, the financial year, and a list of reported financial transactions, each with information category (e.g. interest income, dividend, mutual fund purchase/sale, salary), reporting entity name, and amount.',
    '{
      "type": "object",
      "required": ["pan", "financial_year", "transactions"],
      "properties": {
        "pan": {"type": "string"},
        "financial_year": {"type": "string"},
        "transactions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "information_category": {"type": "string"},
              "reporting_entity": {"type": "string"},
              "amount": {"type": "number"}
            }
          }
        }
      }
    }'::jsonb,
    0.65,
    true
  ),
  (
    'gst_sales_invoice',
    'cafocus',
    'cafocus/small-business',
    'This is a GST sales (outward) invoice issued in India. Extract the invoice number, invoice date, seller GSTIN, buyer GSTIN (if present), taxable value, CGST amount, SGST amount, IGST amount, and total invoice amount.',
    '{
      "type": "object",
      "required": ["invoice_number", "invoice_date", "seller_gstin", "taxable_value", "total_amount"],
      "properties": {
        "invoice_number": {"type": "string"},
        "invoice_date": {"type": "string"},
        "seller_gstin": {"type": "string"},
        "buyer_gstin": {"type": "string"},
        "taxable_value": {"type": "number"},
        "cgst_amount": {"type": "number"},
        "sgst_amount": {"type": "number"},
        "igst_amount": {"type": "number"},
        "total_amount": {"type": "number"}
      }
    }'::jsonb,
    0.75,
    true
  ),
  (
    'gst_purchase_invoice',
    'cafocus',
    'cafocus/small-business',
    'This is a GST purchase (inward) invoice received in India. Extract the invoice number, invoice date, seller GSTIN, buyer GSTIN (if present), taxable value, CGST amount, SGST amount, IGST amount, and total invoice amount.',
    '{
      "type": "object",
      "required": ["invoice_number", "invoice_date", "seller_gstin", "taxable_value", "total_amount"],
      "properties": {
        "invoice_number": {"type": "string"},
        "invoice_date": {"type": "string"},
        "seller_gstin": {"type": "string"},
        "buyer_gstin": {"type": "string"},
        "taxable_value": {"type": "number"},
        "cgst_amount": {"type": "number"},
        "sgst_amount": {"type": "number"},
        "igst_amount": {"type": "number"},
        "total_amount": {"type": "number"}
      }
    }'::jsonb,
    0.75,
    true
  )
on conflict (document_type, vertical) do nothing;
