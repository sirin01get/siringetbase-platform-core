import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { reverse } from "@/lib/payments/escrow";

interface ReverseBody {
  escrow_hold_id?: string;
  reason?: string;
}

// POST /api/payments/reverse — the cross-Worker entry point for "refund
// the client, the engagement never got delivered". Same shape as ./hold
// and ./release: authenticate, translate snake_case, delegate to
// src/lib/payments/escrow.ts's reverse(). Called from cafocus/app when
// either party cancels an active (paid, not-yet-filed) engagement — see
// src/lib/marketplace/service.ts's cancelEngagement().
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-payments-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.paymentsInternalSecret())) {
    return NextResponse.json(
      { status: "error", message: "Missing or invalid x-payments-internal-secret header" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as ReverseBody;
  const { escrow_hold_id, reason } = body;

  if (!escrow_hold_id || !reason) {
    return NextResponse.json(
      { status: "error", message: "Expected { escrow_hold_id, reason }." },
      { status: 400 }
    );
  }

  try {
    const result = await reverse({ escrowHoldId: escrow_hold_id, reason });

    return NextResponse.json({
      status: result.success ? "ok" : "error",
      success: result.success,
      provider_transaction_id: result.providerTransactionId,
      message: result.success ? undefined : "Refund did not succeed — see provider_transactions for the raw response.",
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
