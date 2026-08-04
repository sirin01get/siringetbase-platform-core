import { NextResponse } from "next/server";
import { listCommsTemplateVersions } from "@/lib/comms/templates/store";
import { requireAdmin } from "@/lib/admin/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, "comms.template.versions.list", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const rows = await listCommsTemplateVersions(id);
    return NextResponse.json({ status: "ok", rows });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not load version history." },
      { status: 500 }
    );
  }
}
