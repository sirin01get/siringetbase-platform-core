import { NextResponse } from "next/server";
import { listTemplateVersions } from "@/lib/document-intelligence/templates";
import { requireAdmin } from "@/lib/admin/auth";

// Read-only history for one extraction_templates row — see
// ../../../../../../../src/lib/document-intelligence/templates.ts's
// header comment on upsertExtractionTemplate() for what populates this.
// [id] here is the LIVE template's id (extraction_templates.id), not a
// version id — this lists every version ever snapshotted for it.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, "document_intelligence.extraction_template.versions.list", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const rows = await listTemplateVersions(id);
    return NextResponse.json({ status: "ok", rows });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not load template version history." },
      { status: 500 }
    );
  }
}
