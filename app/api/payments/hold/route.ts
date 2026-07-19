import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { hold } from "@/lib/payments/escrow";

interface HoldBody {
  engagement_id?: string;
  vertical?: string;
  amount?: number;
  role_profile_id?: string;
  description?: string;
}

// POST /api/payments/hold — the cross-Worker entry point for "charge the
// client and put the money in escrow", called from a calling vertical's own
// backend right after it accepts an engagement (cafocus/app's
// src/lib/marketplace/payments-client.ts today). Same "Two Entry Points"
// shape and same secret-header-protected posture as
// document-intelligence/extract/route.ts — see that file's header comment
// for the full reasoning; this is the same pattern, just fronting
// src/lib/payments/escrow.ts's hold() instead of extractDocument().
//
// Deliberately thin: all the actual logic (calling the active
// PaymentGatewayPort, writing payments/escrow_holds/provider_transactions)
// already lives in escrow.ts — this route only authenticates the caller and
// translates snake_case JSON into that function's params.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-payments-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.paymentsInternalSecret())) {
    return NextResponse.json(
      { status: "error", message: "Missing or invalid x-payments-internal-secret header" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as HoldBody;
  const { engagement_id, vertical, amount, role_profile_id, description } = body;

  if (!engagement_id || !vertical || !amount || !role_profile_id || !description) {
    return NextResponse.json(
      {
        status: "error",
        message: "Expected { engagement_id, vertical, amount, role_profile_id, description }.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await hold({
      engagementId: engagement_id,
      vertical,
      amount,
      roleProfileId: role_profile_id,
      description,
    });

    return NextResponse.json({
      status: result.success ? "ok" : "error",
      success: result.success,
      payment_id: result.paymentId,
      escrow_hold_id: result.escrowHoldId ?? null,
      provider_transaction_id: result.providerTransactionId,
      message: result.success ? undefined : "Charge did not succeed — see provider_transactions for the raw response.",
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
