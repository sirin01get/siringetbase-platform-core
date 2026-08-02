import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { connectGstin } from "@/lib/gst-gsp/service";

interface ConnectBody {
  organization_id?: string;
  vertical?: string;
  gstin?: string;
  consent_note?: string;
}

// POST /api/gst-gsp/connect — the cross-Worker entry point for "start a
// per-taxpayer GSP consent grant", called from a calling vertical's own
// backend when a CA connects a client's GSTIN (cafocus/app's
// src/lib/gst-gsp/gst-gsp-client.ts). Same "Two Entry Points" shape and
// same secret-header-protected posture as payments/hold/route.ts — see
// that file's header comment for the full reasoning; this is the same
// pattern, just fronting src/lib/gst-gsp/service.ts's connectGstin()
// instead of escrow.ts's hold().
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-gst-gsp-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.gstGspInternalSecret())) {
    return NextResponse.json(
      { status: "error", message: "Missing or invalid x-gst-gsp-internal-secret header" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as ConnectBody;
  const { organization_id, vertical, gstin, consent_note } = body;

  if (!organization_id || !vertical || !gstin) {
    return NextResponse.json(
      { status: "error", message: "Expected { organization_id, vertical, gstin }." },
      { status: 400 }
    );
  }

  try {
    const result = await connectGstin({
      organizationId: organization_id,
      vertical,
      gstin,
      consentNote: consent_note,
    });

    return NextResponse.json({
      status: result.success ? "ok" : "error",
      success: result.success,
      connection_id: result.connectionId ?? null,
      connection_reference: result.connectionReference,
      connection_status: result.status,
      message: result.success ? undefined : (result.failureReason ?? "Connection did not succeed."),
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
