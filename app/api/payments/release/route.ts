import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { release } from "@/lib/payments/escrow";

interface ReleaseBody {
  escrow_hold_id?: string;
  vertical?: string;
  service_provider_role_profile_id?: string;
  commission_rate?: number;
  payout_account_id?: string;
  account_number_last4?: string;
  ifsc?: string;
  account_holder_name?: string;
}

// POST /api/payments/release — the cross-Worker entry point for "milestone
// hit, pay the service provider out of escrow minus commission". Same shape
// as ./hold's route: authenticate, translate snake_case, delegate to
// src/lib/payments/escrow.ts's release(). Called from cafocus/app right
// after a CA advances a filing to its terminal 'confirmed' state
// (src/lib/marketplace/service.ts's advanceFilingState()) —
// commission_rate is passed in by the caller since it's not sourced from a
// real rate card yet (siringetbase/billing's revenue_share_rates isn't
// migrated), same caller-supplied posture escrow.ts's own header comment
// already documents.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-payments-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.paymentsInternalSecret())) {
    return NextResponse.json(
      { status: "error", message: "Missing or invalid x-payments-internal-secret header" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as ReleaseBody;
  const {
    escrow_hold_id,
    vertical,
    service_provider_role_profile_id,
    commission_rate,
    payout_account_id,
    account_number_last4,
    ifsc,
    account_holder_name,
  } = body;

  if (
    !escrow_hold_id ||
    !vertical ||
    !service_provider_role_profile_id ||
    commission_rate === undefined ||
    !payout_account_id ||
    !account_number_last4 ||
    !ifsc ||
    !account_holder_name
  ) {
    return NextResponse.json(
      {
        status: "error",
        message:
          "Expected { escrow_hold_id, vertical, service_provider_role_profile_id, commission_rate, payout_account_id, account_number_last4, ifsc, account_holder_name }.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await release({
      escrowHoldId: escrow_hold_id,
      vertical,
      serviceProviderRoleProfileId: service_provider_role_profile_id,
      commissionRate: commission_rate,
      payoutAccountId: payout_account_id,
      accountNumberLast4: account_number_last4,
      ifsc,
      accountHolderName: account_holder_name,
    });

    return NextResponse.json({
      status: result.success ? "ok" : "error",
      success: result.success,
      commission_amount: result.commissionAmount ?? null,
      net_payout_amount: result.netPayoutAmount ?? null,
      provider_transaction_id: result.providerTransactionId,
      message: result.success ? undefined : "Payout did not succeed — see provider_transactions for the raw response.",
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
