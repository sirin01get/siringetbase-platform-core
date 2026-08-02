import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { getGstReturnStatus } from "@/lib/gst-gsp/service";

interface StatusBody {
  push_id?: string;
}

// POST /api/gst-gsp/status — the cross-Worker entry point for "poll GSTN's
// filing state via the GSP", so a filing workbench can show queued ->
// submitted -> filed/rejected without re-pushing. POST (not GET) to keep
// the same secret-header auth shape as every other gst-gsp route — a
// GET-with-body isn't reliably supported across fetch clients.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-gst-gsp-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.gstGspInternalSecret())) {
    return NextResponse.json(
      { status: "error", message: "Missing or invalid x-gst-gsp-internal-secret header" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as StatusBody;
  const { push_id } = body;

  if (!push_id) {
    return NextResponse.json({ status: "error", message: "Expected { push_id }." }, { status: 400 });
  }

  try {
    const result = await getGstReturnStatus(push_id);

    return NextResponse.json({
      status: "ok",
      push_reference: result.pushReference,
      push_status: result.status,
      gsp_acknowledgment_number: result.gspAcknowledgmentNumber ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
