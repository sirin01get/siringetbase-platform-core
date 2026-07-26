import { NextResponse } from "next/server";
import { restoreTemplateVersion } from "@/lib/document-intelligence/templates";
import { requireAdmin } from "@/lib/admin/auth";
import { writeAuditLog } from "@/lib/admin/audit";

// The actual rollback action — "recover the last working template" per the
// explicit instruction behind this whole versioning feature (see
// 0024_extraction_templates_versions.sql's header comment). Restoring goes
// through the same upsertExtractionTemplate() path any other edit does, so
// the row being REPLACED by this restore is itself snapshotted first — a
// bad restore is always undoable too, same guarantee as every other edit.
export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireAdmin(request, "document_intelligence.extraction_template.versions.restore", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const { versionId } = await params;

  try {
    const result = await restoreTemplateVersion(versionId, { versionedByRoleProfileId: auth.actor.roleProfileId });
    await writeAuditLog({
      actor: auth.actor,
      action: "document_intelligence.extraction_template.versions.restore",
      targetType: "extraction_template",
      targetId: result.id,
      outcome: "success",
      detail: { restored_from_version_id: versionId },
      request,
    });
    return NextResponse.json({ status: "ok", id: result.id });
  } catch (err) {
    await writeAuditLog({
      actor: auth.actor,
      action: "document_intelligence.extraction_template.versions.restore",
      outcome: "error",
      detail: { version_id: versionId, error: err instanceof Error ? err.message : String(err) },
      request,
    });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not restore template version." },
      { status: 500 }
    );
  }
}
