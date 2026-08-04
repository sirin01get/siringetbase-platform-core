import { NextResponse } from "next/server";
import { deleteCommsTemplate } from "@/lib/comms/templates/store";
import { requireAdmin } from "@/lib/admin/auth";
import { writeAuditLog } from "@/lib/admin/audit";

// Reverts one (vertical, role, trigger_event) override back to its
// compiled-in default — the override row is snapshotted before deletion
// (see ../../../../../src/lib/comms/templates/store.ts's
// deleteCommsTemplate()), so this is itself undoable via version history,
// same as every other write against this table.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, "comms.template.delete", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    await deleteCommsTemplate(id, { versionedByRoleProfileId: auth.actor.roleProfileId });
    await writeAuditLog({
      actor: auth.actor,
      action: "comms.template.delete",
      targetType: "comms_template",
      targetId: id,
      outcome: "success",
      detail: {},
      request,
    });
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    await writeAuditLog({
      actor: auth.actor,
      action: "comms.template.delete",
      outcome: "error",
      detail: { id, error: err instanceof Error ? err.message : String(err) },
      request,
    });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not delete comms template." },
      { status: 500 }
    );
  }
}
