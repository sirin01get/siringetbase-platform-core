import { NextResponse } from "next/server";
import { listExtractionTemplates, upsertExtractionTemplate } from "@/lib/document-intelligence/templates";
import { requireAdmin } from "@/lib/admin/auth";
import { writeAuditLog } from "@/lib/admin/audit";

interface UpsertBody {
  document_type?: string;
  vertical?: string;
  owning_module?: string;
  prompt?: string;
  output_schema?: string; // JSON text from a textarea, parsed below
  confidence_threshold?: number;
  requires_human_review?: boolean;
}

// Admin control plane for siringetbase.extraction_templates — see
// ../../../../../src/lib/document-intelligence/templates.ts's header
// comment for why this exists. Read by app/admin/document-intelligence's
// list + form, and by cafocus/app's own admin service-types page (a
// read-only, cross-Worker call — see that repo's
// src/lib/document-intelligence/coverage-client.ts — to show "which
// document types already have AI extraction wired" right where a
// business_admin creates a new service).
export async function GET(request: Request) {
  const auth = await requireAdmin(request, "document_intelligence.extraction_template.list", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const vertical = searchParams.get("vertical") ?? undefined;

  try {
    const rows = await listExtractionTemplates(vertical);
    return NextResponse.json({ status: "ok", rows });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not load extraction templates." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request, "document_intelligence.extraction_template.upsert", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as UpsertBody;

  if (!body.document_type?.trim()) {
    return NextResponse.json({ status: "error", message: "document_type is required." }, { status: 400 });
  }
  if (!body.vertical?.trim()) {
    return NextResponse.json({ status: "error", message: "vertical is required." }, { status: 400 });
  }
  if (!body.owning_module?.trim()) {
    return NextResponse.json({ status: "error", message: "owning_module is required." }, { status: 400 });
  }
  if (!body.prompt?.trim()) {
    return NextResponse.json({ status: "error", message: "prompt is required." }, { status: 400 });
  }

  let outputSchema: Record<string, unknown>;
  try {
    outputSchema = JSON.parse(body.output_schema ?? "");
    if (typeof outputSchema !== "object" || outputSchema === null || Array.isArray(outputSchema)) {
      throw new Error("output_schema must be a JSON object.");
    }
  } catch {
    return NextResponse.json(
      { status: "error", message: "output_schema must be valid JSON (a single object, e.g. { \"type\": \"object\", \"required\": [...], \"properties\": {...} })." },
      { status: 400 }
    );
  }

  const confidenceThreshold = body.confidence_threshold ?? 0.8;
  if (confidenceThreshold < 0 || confidenceThreshold > 1) {
    return NextResponse.json({ status: "error", message: "confidence_threshold must be between 0 and 1." }, { status: 400 });
  }

  try {
    const result = await upsertExtractionTemplate({
      documentType: body.document_type.trim(),
      vertical: body.vertical.trim(),
      owningModule: body.owning_module.trim(),
      prompt: body.prompt.trim(),
      outputSchema,
      confidenceThreshold,
      requiresHumanReview: body.requires_human_review ?? true,
    });
    await writeAuditLog({
      actor: auth.actor,
      action: "document_intelligence.extraction_template.upsert",
      targetType: "extraction_template",
      targetId: result.id,
      outcome: "success",
      detail: { document_type: body.document_type, vertical: body.vertical, owning_module: body.owning_module },
      request,
    });
    return NextResponse.json({ status: "ok", id: result.id });
  } catch (err) {
    await writeAuditLog({
      actor: auth.actor,
      action: "document_intelligence.extraction_template.upsert",
      outcome: "error",
      detail: { ...body, error: err instanceof Error ? err.message : String(err) },
      request,
    });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not save extraction template." },
      { status: 500 }
    );
  }
}
