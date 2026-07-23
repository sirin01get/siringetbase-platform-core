import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { chargeMandate } from "@/lib/payments/recurring";

interface ChargeMandateBody {
  mandate_reference?: string;
  role_profile_id?: string;
  vertical?: string;
  amount?: number;
  description?: string;
}

// POST /api/payments/mandates/charge — cross-Worker entry point for "draw
// this period's amount from an existing mandate", called both by a CA's
// first-period subscribe flow and by the recurring billing cron (see
// cafocus/app's src/lib/subscriptions/subscription-billing.ts and
// this repo's worker.ts's third cron schedule). Same posture as
// ../create/route.ts and ../../hold/route.ts.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-payments-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.paymentsInternalSecret())) {
    return NextResponse.json(
      { status: "error", message: "Missing or invalid x-payments-internal-secret header" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as ChargeMandateBody;
  const { mandate_reference, role_profile_id, vertical, amount, description } = body;

  if (!mandate_reference || !role_profile_id || !vertical || !amount || !description) {
    return NextResponse.json(
      {
        status: "error",
        message: "Expected { mandate_reference, role_profile_id, vertical, amount, description }.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await chargeMandate({
      mandateReference: mandate_reference,
      roleProfileId: role_profile_id,
      vertical,
      amount,
      description,
    });

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
