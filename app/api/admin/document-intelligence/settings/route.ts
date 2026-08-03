import { NextResponse } from "next/server";
import { getDocumentIntelligenceSettings, setPrimaryProvider, type PrimaryProvider } from "@/lib/document-intelligence/settings";
import { requireAdmin } from "@/lib/admin/auth";
import { writeAuditLog } from "@/lib/admin/audit";

interface UpdateBody {
  primary_provider?: string;
}

const VALID_PROVIDERS = new Set(["workers_ai", "openai", "gemini"]);

// Runtime toggle for siringetbase.document_intelligence_settings — see
// ../../../../../supabase/migrations/0033_document_intelligence_settings.sql's
// header comment and ./settings.ts for the full "why a mutable row, not an
// env var" reasoning. GET reads the current setting for the admin UI;
// POST flips it, taking effect on the very next extraction attempt (no
// redeploy) — extract.ts reads this row fresh on every call.
export async function GET(request: Request) {
  const auth = await requireAdmin(request, "document_intelligence.settings.view", ["business_admin"]);
  if (!auth.ok) return auth.response;

  try {
    const settings = await getDocumentIntelligenceSettings();
    return NextResponse.json({ status: "ok", settings });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not load settings." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request, "document_intelligence.settings.update", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as UpdateBody;
  const primaryProvider = body.primary_provider;

  if (!primaryProvider || !VALID_PROVIDERS.has(primaryProvider)) {
    return NextResponse.json(
      { status: "error", message: `primary_provider must be one of: ${[...VALID_PROVIDERS].join(", ")}.` },
      { status: 400 }
    );
  }

  try {
    await setPrimaryProvider({
      primaryProvider: primaryProvider as PrimaryProvider,
      updatedByRoleProfileId: auth.actor.roleProfileId,
    });
    await writeAuditLog({
      actor: auth.actor,
      action: "document_intelligence.settings.update",
      targetType: "document_intelligence_settings",
      outcome: "success",
      detail: { primary_provider: primaryProvider },
      request,
    });
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    await writeAuditLog({
      actor: auth.actor,
      action: "document_intelligence.settings.update",
      outcome: "error",
      detail: { primary_provider: primaryProvider, error: err instanceof Error ? err.message : String(err) },
      request,
    });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not update settings." },
      { status: 500 }
    );
  }
}
