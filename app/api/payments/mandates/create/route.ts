import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { createMandate } from "@/lib/payments/recurring";

interface CreateMandateBody {
  role_profile_id?: string;
  vertical?: string;
  description?: string;
}

// POST /api/payments/mandates/create — cross-Worker entry point for
// "authorize a recurring auto-debit", called when a CA picks "Auto-renew"
// on a module subscription (cafocus/app's
// src/lib/subscriptions/subscription-service.ts). Same secret-header,
// same-shape-thin-wrapper posture as ../hold/route.ts — see that file's
// header comment; this fronts ../../../../src/lib/payments/recurring.ts's
// createMandate() instead of escrow.ts's hold().
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-payments-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.paymentsInternalSecret())) {
    return NextResponse.json(
      { status: "error", message: "Missing or invalid x-payments-internal-secret header" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as CreateMandateBody;
  const { role_profile_id, vertical, description } = body;

  if (!role_profile_id || !vertical || !description) {
    return NextResponse.json(
      { status: "error", message: "Expected { role_profile_id, vertical, description }." },
      { status: 400 }
    );
  }

  try {
    const result = await createMandate({ roleProfileId: role_profile_id, vertical, description });

    return NextResponse.json({
      status: result.success ? "ok" : "error",
      success: result.success,
      mandate_reference: result.mandateReference,
      message: result.success ? undefined : "Mandate setup did not succeed — see payment_mandates for status.",
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
