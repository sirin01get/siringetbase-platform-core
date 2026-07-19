import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { extractDocument } from "@/lib/document-intelligence/extract";

// POST /api/document-intelligence/extract — the cross-Worker entry point
// for "run extraction against a document I just uploaded", called from a
// calling vertical's own backend (cafocus/app's
// src/lib/document-intelligence/trigger.ts today), same "Two Entry Points"
// shape as comms' POST /api/comms/notify and support-escalation's use of
// it — see ../../../../document-intelligence/README.md.
//
// Secret-header-protected like comms/notify (not a signed webhook — no
// third-party signer here, just a single trusted caller per vertical).
// Reuses verify-webhook.ts's timingSafeEqual() rather than duplicating a
// constant-time string comparison.
//
// Receives the raw file bytes over multipart/form-data, not just a
// document_id: platform-core has no R2 binding into the calling vertical's
// bucket (cafocus/app's CA_DOCUMENTS binding is a different Worker's
// binding entirely), so the caller must hand over the bytes it already has
// from its own upload.

function errorResponse(httpCode: number, message: string) {
  return NextResponse.json({ status: "error", message }, { status: httpCode });
}

export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-document-intelligence-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.documentIntelligenceInternalSecret())) {
    return errorResponse(401, "Missing or invalid x-document-intelligence-internal-secret header");
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse(400, "Expected multipart/form-data.");
  }

  const documentId = String(formData.get("document_id") ?? "").trim();
  const file = formData.get("file");

  if (!documentId) {
    return errorResponse(400, "document_id is required.");
  }
  if (!(file instanceof File) || file.size === 0) {
    return errorResponse(400, "file is required.");
  }

  try {
    const imageBytes = await file.arrayBuffer();
    const outcome = await extractDocument({ documentId, imageBytes, contentType: file.type });

    if (outcome.status === "failed") {
      return NextResponse.json({ status: "error", message: outcome.reason, job_id: outcome.jobId }, { status: 502 });
    }

    return NextResponse.json({
      status: "ok",
      outcome: outcome.status,
      job_id: outcome.jobId,
      confidence: outcome.confidence,
      reason: outcome.reason,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
