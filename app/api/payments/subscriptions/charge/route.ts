import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { chargeSubscriptionDirect } from "@/lib/payments/recurring";

interface ChargeBody {
  role_profile_id?: string;
  vertical?: string;
  amount?: number;
  description?: string;
}

// POST /api/payments/subscriptions/charge — the "manual_monthly" payment
// mode's charge entry point: no mandate, a direct one-time collection
// (../mandates/charge/route.ts is the "auto" mode's equivalent, drawing
// against a stored mandate instead). Used for a manual-mode CA's own
// "Pay now" action and for that mode's first period at subscribe time. See
// ../../../../src/lib/payments/recurring.ts's chargeSubscriptionDirect()
// for why this books identically to a mandate draw.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-payments-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.paymentsInternalSecret())) {
    return NextResponse.json(
      { status: "error", message: "Missing or invalid x-payments-internal-secret header" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as ChargeBody;
  const { role_profile_id, vertical, amount, description } = body;

  if (!role_profile_id || !vertical || !amount || !description) {
    return NextResponse.json(
      { status: "error", message: "Expected { role_profile_id, vertical, amount, description }." },
      { status: 400 }
    );
  }

  try {
    const result = await chargeSubscriptionDirect({ roleProfileId: role_profile_id, vertical, amount, description });

    return NextResponse.json({
      status: result.success ? "ok" : "error",
      success: result.success,
      payment_id: result.paymentId,
      provider_transaction_id: result.providerTransactionId,
      charge_status: result.status,
      message: result.success ? undefined : (result.failureReason ?? "Charge did not succeed."),
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
