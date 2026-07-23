import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Admin control plane for siringetbase.extraction_templates (see
// ../../../supabase/migrations/0003_document_intelligence_skeleton.sql for
// the table, ../../../supabase/migrations/0021_extraction_templates_seed.sql
// for that migration's header comment on why this exists: the table sat
// empty for the whole life of this project, so every document upload has
// been silently skipped by extract.ts's "no template registered" branch
// regardless of document_type. This file + its API route give a
// business_admin a way to see what's registered and add more without a raw
// SQL migration each time — same shape as ./billing/rate-card.ts and
// ./billing/subscription-plans.ts, just no effective-dating (a template is
// either registered for a (document_type, vertical) pair or it isn't; the
// unique constraint on that pair means "add" is really "add or replace",
// handled with an upsert below rather than the close-previous-row pattern
// those two files use).

export interface ExtractionTemplateRow {
  id: string;
  documentType: string;
  vertical: string;
  owningModule: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  confidenceThreshold: number;
  requiresHumanReview: boolean;
  createdAt: string;
}

export async function listExtractionTemplates(vertical?: string): Promise<ExtractionTemplateRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  let query = supabase
    .from("extraction_templates")
    .select("id, document_type, vertical, owning_module, prompt, output_schema, confidence_threshold, requires_human_review, created_at")
    .order("vertical", { ascending: true })
    .order("document_type", { ascending: true });
  if (vertical) query = query.eq("vertical", vertical);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    documentType: r.document_type,
    vertical: r.vertical,
    owningModule: r.owning_module,
    prompt: r.prompt,
    outputSchema: r.output_schema as Record<string, unknown>,
    confidenceThreshold: r.confidence_threshold,
    requiresHumanReview: r.requires_human_review,
    createdAt: r.created_at,
  }));
}

// Upsert on (document_type, vertical) — the table's own unique constraint
// (extraction_templates_type_vertical_unique) means there can only ever be
// one template per document type per vertical, so re-submitting the same
// pair from the admin UI is a deliberate "replace the prompt/schema" edit,
// not an error.
export async function upsertExtractionTemplate(params: {
  documentType: string;
  vertical: string;
  owningModule: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  confidenceThreshold: number;
  requiresHumanReview: boolean;
}): Promise<{ id: string }> {
  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase
    .from("extraction_templates")
    .upsert(
      {
        document_type: params.documentType,
        vertical: params.vertical,
        owning_module: params.owningModule,
        prompt: params.prompt,
        output_schema: params.outputSchema,
        confidence_threshold: params.confidenceThreshold,
        requires_human_review: params.requiresHumanReview,
      },
      { onConflict: "document_type,vertical" }
    )
    .select("id")
    .single();

  if (error || !data) throw new Error(`Could not save extraction template: ${error?.message ?? "unknown error"}`);
  return { id: data.id };
}
