import { NextResponse } from "next/server";
import { listCommsTemplates, upsertCommsTemplate } from "@/lib/comms/templates/store";
import { requireAdmin } from "@/lib/admin/auth";
import { writeAuditLog } from "@/lib/admin/audit";

interface UpsertBody {
  vertical?: string;
  role?: string;
  trigger_event?: string;
  subject?: string;
  body_html?: string;
  body_text?: string;
  // Optional context for comms_templates_versions.change_reason — same
  // convention as ../document-intelligence/extraction-templates/route.ts's
  // change_reason field.
  change_reason?: string;
}

// Admin control plane for siringetbase.comms_templates — see
// ../../../../src/lib/comms/templates/store.ts's header comment and
// ../../../../supabase/migrations/0036_comms_templates.sql for why this
// exists: a business_admin edit here takes effect on the next email send
// with no redeploy, via ../../../../src/lib/comms/templates/registry.ts's
// getTemplate() checking this table before the compiled-in copy. Same
// shape as ../document-intelligence/extraction-templates/route.ts.
export async function GET(request: Request) {
  const auth = await requireAdmin(request, "comms.template.list", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const vertical = searchParams.get("vertical") ?? undefined;

  try {
    const rows = await listCommsTemplates(vertical);
    return NextResponse.json({ status: "ok", rows });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not load comms templates." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request, "comms.template.upsert", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as UpsertBody;

  if (!body.vertical?.trim()) {
    return NextResponse.json({ status: "error", message: "vertical is required." }, { status: 400 });
  }
  if (!body.role?.trim()) {
    return NextResponse.json({ status: "error", message: "role is required." }, { status: 400 });
  }
  if (!body.trigger_event?.trim()) {
    return NextResponse.json({ status: "error", message: "trigger_event is required." }, { status: 400 });
  }
  if (!body.subject?.trim()) {
    return NextResponse.json({ status: "error", message: "subject is required." }, { status: 400 });
  }
  if (!body.body_html?.trim()) {
    return NextResponse.json({ status: "error", message: "body_html is required." }, { status: 400 });
  }
  if (!body.body_text?.trim()) {
    return NextResponse.json({ status: "error", message: "body_text is required." }, { status: 400 });
  }

  try {
    const result = await upsertCommsTemplate({
      vertical: body.vertical.trim(),
      role: body.role.trim(),
      triggerEvent: body.trigger_event.trim(),
      subject: body.subject.trim(),
      bodyHtml: body.body_html,
      bodyText: body.body_text,
      versionedByRoleProfileId: auth.actor.roleProfileId,
      changeReason: body.change_reason ?? null,
    });
    await writeAuditLog({
      actor: auth.actor,
      action: "comms.template.upsert",
      targetType: "comms_template",
      targetId: result.id,
      outcome: "success",
      detail: { vertical: body.vertical, role: body.role, trigger_event: body.trigger_event },
      request,
    });
    return NextResponse.json({ status: "ok", id: result.id });
  } catch (err) {
    await writeAuditLog({
      actor: auth.actor,
      action: "comms.template.upsert",
      outcome: "error",
      detail: { ...body, error: err instanceof Error ? err.message : String(err) },
      request,
    });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not save comms template." },
      { status: 500 }
    );
  }
}
