import { NextResponse } from "next/server";
import { restoreCommsTemplateVersion } from "@/lib/comms/templates/store";
import { requireAdmin } from "@/lib/admin/auth";
import { writeAuditLog } from "@/lib/admin/audit";

// The actual rollback action — goes through the same upsertCommsTemplate()
// path any other edit does (see ../../../../../../src/lib/comms/templates/
// store.ts's restoreCommsTemplateVersion()), so the row being REPLACED by
// this restore is itself snapshotted first — a bad restore is always
// undoable too.
export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireAdmin(request, "comms.template.versions.restore", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const { versionId } = await params;

  try {
    const result = await restoreCommsTemplateVersion(versionId, { versionedByRoleProfileId: auth.actor.roleProfileId });
    await writeAuditLog({
      actor: auth.actor,
      action: "comms.template.versions.restore",
      targetType: "comms_template",
      targetId: result.id,
      outcome: "success",
      detail: { restored_from_version_id: versionId },
      request,
    });
    return NextResponse.json({ status: "ok", id: result.id });
  } catch (err) {
    await writeAuditLog({
      actor: auth.actor,
      action: "comms.template.versions.restore",
      outcome: "error",
      detail: { version_id: versionId, error: err instanceof Error ? err.message : String(err) },
      request,
    });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not restore this version." },
      { status: 500 }
    );
  }
}
