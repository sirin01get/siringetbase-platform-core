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
  // 0023_extraction_template_max_tokens.sql — see that migration's comment
  // for why this is per-template rather than a pipeline-wide constant, and
  // ./model-gateway.ts's header comment for why it's threaded through as a
  // plain, provider-agnostic parameter (not a Workers-AI-specific option),
  // which is what makes this the right place to store it even ahead of a
  // second AI provider ever being added.
  maxTokens: number;
  createdAt: string;
}

export async function listExtractionTemplates(vertical?: string): Promise<ExtractionTemplateRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  let query = supabase
    .from("extraction_templates")
    .select("id, document_type, vertical, owning_module, prompt, output_schema, confidence_threshold, requires_human_review, max_tokens, created_at")
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
    maxTokens: r.max_tokens,
    createdAt: r.created_at,
  }));
}

// Upsert on (document_type, vertical) — the table's own unique constraint
// (extraction_templates_type_vertical_unique) means there can only ever be
// one template per document type per vertical, so re-submitting the same
// pair from the admin UI is a deliberate "replace the prompt/schema" edit,
// not an error.
//
// Phase 3 of the ITR_gov_change agent added a hard prerequisite (see
// ../../supabase/migrations/0024_extraction_templates_versions.sql's header
// comment): before this ever overwrites an EXISTING row, that row's prior
// state is snapshotted into extraction_templates_versions first —
// unconditionally, for every edit through this function, not just
// draft-apply ones. A brand-new (document_type, vertical) pair has nothing
// to snapshot, since there's no prior row to lose.
export async function upsertExtractionTemplate(params: {
  documentType: string;
  vertical: string;
  owningModule: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  confidenceThreshold: number;
  requiresHumanReview: boolean;
  maxTokens: number;
  // Who/why this edit is happening — both optional so a caller that
  // genuinely has neither (there shouldn't be one; every real caller is an
  // authenticated admin action) doesn't need to fabricate a value.
  versionedByRoleProfileId?: string | null;
  changeReason?: string | null;
}): Promise<{ id: string }> {
  const supabase = createSupabaseServiceRoleClient();

  const { data: existing } = await supabase
    .from("extraction_templates")
    .select("id, document_type, vertical, owning_module, prompt, output_schema, confidence_threshold, requires_human_review, max_tokens")
    .eq("document_type", params.documentType)
    .eq("vertical", params.vertical)
    .maybeSingle();

  if (existing) {
    const { error: versionError } = await supabase.from("extraction_templates_versions").insert({
      template_id: existing.id,
      document_type: existing.document_type,
      vertical: existing.vertical,
      owning_module: existing.owning_module,
      prompt: existing.prompt,
      output_schema: existing.output_schema,
      confidence_threshold: existing.confidence_threshold,
      requires_human_review: existing.requires_human_review,
      max_tokens: existing.max_tokens,
      versioned_by: params.versionedByRoleProfileId ?? null,
      change_reason: params.changeReason ?? null,
    });
    // A snapshot failure must block the overwrite, not just get logged —
    // the entire point of this table is that a template is never replaced
    // without a recoverable copy existing first. Throwing here means the
    // upsert below never runs.
    if (versionError) {
      throw new Error(`Could not snapshot existing template before saving over it: ${versionError.message}`);
    }
  }

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
        max_tokens: params.maxTokens,
      },
      { onConflict: "document_type,vertical" }
    )
    .select("id")
    .single();

  if (error || !data) throw new Error(`Could not save extraction template: ${error?.message ?? "unknown error"}`);
  return { id: data.id };
}

export interface ExtractionTemplateVersionRow {
  id: string;
  templateId: string | null;
  documentType: string;
  vertical: string;
  owningModule: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  confidenceThreshold: number;
  requiresHumanReview: boolean;
  maxTokens: number;
  versionedAt: string;
  versionedByLabel: string | null;
  changeReason: string | null;
}

export async function listTemplateVersions(templateId: string): Promise<ExtractionTemplateVersionRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("extraction_templates_versions")
    .select(
      "id, template_id, document_type, vertical, owning_module, prompt, output_schema, confidence_threshold, requires_human_review, max_tokens, versioned_at, versioned_by, change_reason"
    )
    .eq("template_id", templateId)
    .order("versioned_at", { ascending: false });

  if (error) throw new Error(error.message);

  // Same per-row role_profile -> auth.admin.getUserById() lookup as
  // src/lib/support/error-reports.ts and cafocus/app's
  // itr-gov-alerts/service.ts use for the same "show a human-readable
  // reviewer, not a bare uuid" reason — fine at this scale (a template's
  // own edit history, not a bulk export).
  const out: ExtractionTemplateVersionRow[] = [];
  for (const row of data ?? []) {
    let versionedByLabel: string | null = null;
    if (row.versioned_by) {
      const { data: roleProfile } = await supabase.from("role_profiles").select("user_id").eq("id", row.versioned_by).maybeSingle();
      if (roleProfile?.user_id) {
        const { data: userData } = await supabase.auth.admin.getUserById(roleProfile.user_id);
        versionedByLabel = userData.user?.email ?? "admin";
      }
    }
    out.push({
      id: row.id,
      templateId: row.template_id,
      documentType: row.document_type,
      vertical: row.vertical,
      owningModule: row.owning_module,
      prompt: row.prompt,
      outputSchema: row.output_schema as Record<string, unknown>,
      confidenceThreshold: row.confidence_threshold,
      requiresHumanReview: row.requires_human_review,
      maxTokens: row.max_tokens,
      versionedAt: row.versioned_at,
      versionedByLabel,
      changeReason: row.change_reason,
    });
  }
  return out;
}

// Recovers a past version as the live row — this is the actual rollback
// action, not a read-only history view. Goes through
// upsertExtractionTemplate() itself so restoring is exactly as safe as any
// other edit: the version being REPLACED by this restore is itself
// snapshotted first, so a bad restore is always undoable too.
export async function restoreTemplateVersion(
  versionId: string,
  actor: { versionedByRoleProfileId?: string | null }
): Promise<{ id: string }> {
  const supabase = createSupabaseServiceRoleClient();
  const { data: version, error } = await supabase
    .from("extraction_templates_versions")
    .select("document_type, vertical, owning_module, prompt, output_schema, confidence_threshold, requires_human_review, max_tokens")
    .eq("id", versionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!version) throw new Error(`No version found with id ${versionId}.`);

  return upsertExtractionTemplate({
    documentType: version.document_type,
    vertical: version.vertical,
    owningModule: version.owning_module,
    prompt: version.prompt,
    outputSchema: version.output_schema as Record<string, unknown>,
    confidenceThreshold: version.confidence_threshold,
    requiresHumanReview: version.requires_human_review,
    maxTokens: version.max_tokens,
    versionedByRoleProfileId: actor.versionedByRoleProfileId,
    changeReason: `Restored from version ${versionId}`,
  });
}
