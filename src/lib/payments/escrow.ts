import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getPaymentGateway, getBankPayout } from "./registry";

// hold / release / reverse — the three primitives ../../payments/README.md
// specifies. Every vertical's marketplace module calls these with its own
// milestone names and engagement IDs; nothing vertical-specific lives here.
// The commission rate is passed in by the caller (sourced from
// ../../billing/'s revenue_share_rates once that subsystem is built) —
// never hardcoded in this file.

export interface HoldParams {
  engagementId: string;
  vertical: string;
  amount: number;
  roleProfileId: string; // the payer
  description: string;
}

export interface HoldResult {
  success: boolean;
  paymentId: string;
  escrowHoldId?: string;
  providerTransactionId: string;
}

// client → platform escrow
export async function hold(params: HoldParams): Promise<HoldResult> {
  const supabase = createSupabaseServiceRoleClient();
  const gateway = getPaymentGateway();

  const chargeResult = await gateway.charge({
    amount: params.amount,
    currency: "INR",
    roleProfileId: params.roleProfileId,
    vertical: params.vertical,
    engagementId: params.engagementId,
    description: params.description,
  });

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .insert({
      role_profile_id: params.roleProfileId,
      vertical: params.vertical,
      engagement_id: params.engagementId,
      amount: params.amount,
      type: "collection",
      status: chargeResult.status,
      gateway_provider: gateway.providerName,
    })
    .select()
    .single();

  if (paymentError || !payment) throw new Error(`Failed to record payment: ${paymentError?.message}`);

  await supabase.from("provider_transactions").insert({
    payment_id: payment.id,
    provider: gateway.providerName,
    provider_transaction_id: chargeResult.providerTransactionId,
    request_snapshot: { ...params },
    response_snapshot: chargeResult.rawResponse,
    status: chargeResult.status,
  });

  if (!chargeResult.success) {
    return { success: false, paymentId: payment.id, providerTransactionId: chargeResult.providerTransactionId };
  }

  const { data: escrowHold, error: escrowError } = await supabase
    .from("escrow_holds")
    .insert({
      engagement_id: params.engagementId,
      vertical: params.vertical,
      amount: params.amount,
      status: "held",
    })
    .select()
    .single();

  if (escrowError || !escrowHold) throw new Error(`Failed to record escrow hold: ${escrowError?.message}`);

  return {
    success: true,
    paymentId: payment.id,
    escrowHoldId: escrowHold.id,
    providerTransactionId: chargeResult.providerTransactionId,
  };
}

export interface ReleaseParams {
  escrowHoldId: string;
  vertical: string;
  serviceProviderRoleProfileId: string;
  commissionRate: number; // e.g. 0.10 for 10% — caller-supplied, see file header
  payoutAccountId: string;
  accountNumberLast4: string;
  ifsc: string;
  accountHolderName: string;
}

export interface ReleaseResult {
  success: boolean;
  commissionAmount?: number;
  netPayoutAmount?: number;
  providerTransactionId: string;
}

// escrow → provider, minus commission
export async function release(params: ReleaseParams): Promise<ReleaseResult> {
  const supabase = createSupabaseServiceRoleClient();
  const bankPayout = getBankPayout();

  const { data: escrowHold, error: fetchError } = await supabase
    .from("escrow_holds")
    .select("*")
    .eq("id", params.escrowHoldId)
    .single();

  if (fetchError || !escrowHold) throw new Error(`Escrow hold not found: ${params.escrowHoldId}`);
  if (escrowHold.status !== "held") {
    throw new Error(`Escrow hold ${params.escrowHoldId} is not held (currently: ${escrowHold.status})`);
  }

  const commissionAmount = Math.round(escrowHold.amount * params.commissionRate * 100) / 100;
  const netPayoutAmount = Math.round((escrowHold.amount - commissionAmount) * 100) / 100;

  const payoutResult = await bankPayout.disburse({
    amount: netPayoutAmount,
    currency: "INR",
    payoutAccountId: params.payoutAccountId,
    accountNumberLast4: params.accountNumberLast4,
    ifsc: params.ifsc,
    accountHolderName: params.accountHolderName,
    reference: escrowHold.id,
  });

  await supabase.from("provider_transactions").insert({
    escrow_hold_id: escrowHold.id,
    provider: bankPayout.providerName,
    provider_transaction_id: payoutResult.providerTransactionId,
    request_snapshot: { ...params, netPayoutAmount },
    response_snapshot: payoutResult.rawResponse,
    status: payoutResult.status,
  });

  if (!payoutResult.success) {
    return { success: false, providerTransactionId: payoutResult.providerTransactionId };
  }

  await supabase
    .from("escrow_holds")
    .update({ status: "released", released_at: new Date().toISOString() })
    .eq("id", escrowHold.id);

  const { error: commissionError } = await supabase.from("commission_ledger").insert({
    escrow_hold_id: escrowHold.id,
    vertical: params.vertical,
    service_provider_role_profile_id: params.serviceProviderRoleProfileId,
    commission_rate: params.commissionRate,
    commission_amount: commissionAmount,
    net_payout_amount: netPayoutAmount,
  });

  if (commissionError) throw new Error(`Failed to record commission entry: ${commissionError.message}`);

  return { success: true, commissionAmount, netPayoutAmount, providerTransactionId: payoutResult.providerTransactionId };
}

export interface ReverseParams {
  escrowHoldId: string;
  reason: string;
}

export interface ReverseResult {
  success: boolean;
  providerTransactionId: string;
}

// escrow → client (refund)
export async function reverse(params: ReverseParams): Promise<ReverseResult> {
  const supabase = createSupabaseServiceRoleClient();
  const gateway = getPaymentGateway();

  const { data: escrowHold, error: fetchError } = await supabase
    .from("escrow_holds")
    .select("*")
    .eq("id", params.escrowHoldId)
    .single();

  if (fetchError || !escrowHold) throw new Error(`Escrow hold not found: ${params.escrowHoldId}`);
  if (escrowHold.status !== "held") {
    throw new Error(`Escrow hold ${params.escrowHoldId} is not held (currently: ${escrowHold.status})`);
  }

  const refundResult = await gateway.refund({
    providerTransactionId: escrowHold.id,
    amount: escrowHold.amount,
    reason: params.reason,
  });

  await supabase.from("provider_transactions").insert({
    escrow_hold_id: escrowHold.id,
    provider: gateway.providerName,
    provider_transaction_id: refundResult.providerTransactionId,
    request_snapshot: { ...params },
    response_snapshot: refundResult.rawResponse,
    status: refundResult.status,
  });

  if (!refundResult.success) {
    return { success: false, providerTransactionId: refundResult.providerTransactionId };
  }

  await supabase
    .from("escrow_holds")
    .update({ status: "reversed", reversed_at: new Date().toISOString() })
    .eq("id", escrowHold.id);

  return { success: true, providerTransactionId: refundResult.providerTransactionId };
}
