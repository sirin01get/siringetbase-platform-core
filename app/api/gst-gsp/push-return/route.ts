import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { pushGstReturn } from "@/lib/gst-gsp/service";

interface PushReturnBody {
  connection_id?: string;
  filing_id?: string;
  period?: string;
  return_data?: Record<string, unknown>;
  submission_note?: string;
}

// POST /api/gst-gsp/push-return — the cross-Worker entry point for
// "submit a prepared return to the GSP", called once a filing's rollup
// (cafocus's src/lib/gst/rollup.ts) is ready and blocker-free. Same
// secret-header-protected posture as payments/hold/route.ts.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-gst-gsp-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.gstGspInternalSecret())) {
    return NextResponse.json(
      { status: "error", message: "Missing or invalid x-gst-gsp-internal-secret header" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as PushReturnBody;
  const { connection_id, filing_id, period, return_data, submission_note } = body;

  if (!connection_id || !period || !return_data) {
    return NextResponse.json(
      { status: "error", message: "Expected { connection_id, period, return_data }." },
      { status: 400 }
    );
  }

  try {
    const result = await pushGstReturn({
      connectionId: connection_id,
      filingId: filing_id,
      period,
      returnData: return_data,
      submissionNote: submission_note,
    });

    return NextResponse.json({
      status: result.success ? "ok" : "error",
      success: result.success,
      push_id: result.pushId ?? null,
      push_reference: result.pushReference,
      push_status: result.status,
      message: result.success ? undefined : (result.failureReason ?? "Push did not succeed — see provider_transactions for the raw response."),
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
