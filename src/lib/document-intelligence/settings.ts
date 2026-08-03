import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Service layer for siringetbase.document_intelligence_settings — see
// supabase/migrations/0033_document_intelligence_settings.sql's header
// comment for the full "why a mutable row, not an env var" reasoning. Read
// by extract.ts on every extraction attempt; written by the admin API
// route + UI toggle on /admin/document-intelligence/performance.

export type PrimaryProvider = "workers_ai" | "openai" | "gemini";

const SETTINGS_ROW_ID = "default";

// Fails open to "workers_ai" (today's original, pre-this-feature behavior)
// on ANY read error — a settings-table hiccup should never change what
// provider a real extraction uses in a way nobody chose; if this can't be
// read, behave exactly as if the feature didn't exist.
export async function getPrimaryProvider(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>
): Promise<PrimaryProvider> {
  try {
    const { data, error } = await supabase
      .from("document_intelligence_settings")
      .select("primary_provider")
      .eq("id", SETTINGS_ROW_ID)
      .maybeSingle();
    if (error || !data) return "workers_ai";
    return data.primary_provider;
  } catch {
    return "workers_ai";
  }
}

export interface DocumentIntelligenceSettingsRow {
  primaryProvider: PrimaryProvider;
  updatedAt: string;
  updatedByLabel: string | null;
}

export async function getDocumentIntelligenceSettings(): Promise<DocumentIntelligenceSettingsRow> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("document_intelligence_settings")
    .select("primary_provider, updated_at, updated_by")
    .eq("id", SETTINGS_ROW_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);

  let updatedByLabel: string | null = null;
  if (data?.updated_by) {
    // Same per-row role_profile -> auth.admin.getUserById() lookup as
    // templates.ts's listTemplateVersions() uses for the identical "show a
    // human-readable actor, not a bare uuid" reason.
    const { data: roleProfile } = await supabase.from("role_profiles").select("user_id").eq("id", data.updated_by).maybeSingle();
    if (roleProfile?.user_id) {
      const { data: userData } = await supabase.auth.admin.getUserById(roleProfile.user_id);
      updatedByLabel = userData.user?.email ?? "admin";
    }
  }

  return {
    primaryProvider: data?.primary_provider ?? "workers_ai",
    updatedAt: data?.updated_at ?? new Date(0).toISOString(),
    updatedByLabel,
  };
}

export async function setPrimaryProvider(params: {
  primaryProvider: PrimaryProvider;
  updatedByRoleProfileId?: string | null;
}): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("document_intelligence_settings")
    .upsert({
      id: SETTINGS_ROW_ID,
      primary_provider: params.primaryProvider,
      updated_at: new Date().toISOString(),
      updated_by: params.updatedByRoleProfileId ?? null,
    });
  if (error) throw new Error(error.message);
}
