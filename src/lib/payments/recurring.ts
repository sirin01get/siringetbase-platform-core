import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getPaymentGateway } from "./registry";

// createMandate / chargeMandate — the recurring-billing counterparts to
// ./escrow.ts's hold()/release()/reverse(). A mandate is set up once (when
// a CA picks "Auto-renew" on a module subscription) and drawn against on a
// cadence by the recurring billing cron
// (../../../app/api/admin/billing/... TODO see
// cafocus/app/src/lib/subscriptions/subscription-billing.ts, which calls
// chargeMandate() below once per due subscription). Every vertical's own
// subscription table (cafocus.ca_module_subscriptions) stores only the
// opaque mandate_reference string this returns — same "opaque reference
// into a vertical's own schema" posture payments.engagement_id already
// uses in the other direction.

export interface CreateMandateParams {
  roleProfileId: string;
  vertical: string;
  description: string;
}

export interface CreateMandateResult {
  success: boolean;
  mandateId: string;
  mandateReference: string;
  providerName: string;
}

export async function createMandate(params: CreateMandateParams): Promise<CreateMandateResult> {
  const supabase = createSupabaseServiceRoleClient();
  const gateway = getPaymentGateway();

  const result = await gateway.createMandate({
    roleProfileId: params.roleProfileId,
    vertical: params.vertical,
    description: params.description,
  });

  const { data: mandate, error } = await supabase
    .from("payment_mandates")
    .insert({
      role_profile_id: params.roleProfileId,
      vertical: params.vertical,
      provider: gateway.providerName,
      mandate_reference: result.mandateReference,
      status: result.status,
    })
    .select("id")
    .single();

  if (error || !mandate) throw new Error(`Failed to record payment mandate: ${error?.message}`);

  return {
    success: result.success,
    mandateId: mandate.id,
    mandateReference: result.mandateReference,
    providerName: gateway.providerName,
  };
}

export interface ChargeMandateParams {
  mandateReference: string;
  roleProfileId: string;
  vertical: string;
  amount: number;
  description: string;
}

export interface ChargeMandateResult {
  success: boolean;
  paymentId: string;
  providerTransactionId: string;
  status: "completed" | "failed" | "pending";
  failureReason?: string;
}

// Draws against an already-active mandate — records exactly like a plain
// collection charge (escrow.ts's hold()) except type='subscription_charge'
// and no escrow_holds row, since a subscription charge is never held and
// released, it's collected outright each period.
export async function chargeMandate(params: ChargeMandateParams): Promise<ChargeMandateResult> {
  const supabase = createSupabaseServiceRoleClient();
  const gateway = getPaymentGateway();

  const chargeResult = await gateway.chargeMandate({
    mandateReference: params.mandateReference,
    amount: params.amount,
    currency: "INR",
    description: params.description,
  });

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .insert({
      role_profile_id: params.roleProfileId,
      vertical: params.vertical,
      amount: params.amount,
      type: "subscription_charge",
      status: chargeResult.status,
      gateway_provider: gateway.providerName,
    })
    .select()
    .single();

  if (paymentError || !payment) throw new Error(`Failed to record subscription payment: ${paymentError?.message}`);

  await supabase.from("provider_transactions").insert({
    payment_id: payment.id,
    provider: gateway.providerName,
    provider_transaction_id: chargeResult.providerTransactionId,
    request_snapshot: { ...params },
    response_snapshot: chargeResult.rawResponse,
    status: chargeResult.status,
  });

  return {
    success: chargeResult.success,
    paymentId: payment.id,
    providerTransactionId: chargeResult.providerTransactionId,
    status: chargeResult.status,
    failureReason: chargeResult.failureReason,
  };
}

export interface ChargeSubscriptionDirectParams {
  roleProfileId: string;
  vertical: string;
  amount: number;
  description: string;
}

// The "manual_monthly" counterpart to chargeMandate() — no standing mandate
// to draw against, so this goes straight to gateway.charge() (same
// primitive escrow.ts's hold() uses for a one-time collection). Used both
// for a manual-mode CA's own "Pay now" action and for that mode's very
// first period at subscribe time (see
// cafocus/app/src/lib/subscriptions/subscription-service.ts). Records
// identically to chargeMandate() (type='subscription_charge') so both
// payment modes show up the same way in reporting — only how the charge
// was authorized differs, not how it's booked.
export async function chargeSubscriptionDirect(params: ChargeSubscriptionDirectParams): Promise<ChargeMandateResult> {
  const supabase = createSupabaseServiceRoleClient();
  const gateway = getPaymentGateway();

  const chargeResult = await gateway.charge({
    amount: params.amount,
    currency: "INR",
    roleProfileId: params.roleProfileId,
    vertical: params.vertical,
    description: params.description,
  });

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .insert({
      role_profile_id: params.roleProfileId,
      vertical: params.vertical,
      amount: params.amount,
      type: "subscription_charge",
      status: chargeResult.status,
      gateway_provider: gateway.providerName,
    })
    .select()
    .single();

  if (paymentError || !payment) throw new Error(`Failed to record subscription payment: ${paymentError?.message}`);

  await supabase.from("provider_transactions").insert({
    payment_id: payment.id,
    provider: gateway.providerName,
    provider_transaction_id: chargeResult.providerTransactionId,
    request_snapshot: { ...params },
    response_snapshot: chargeResult.rawResponse,
    status: chargeResult.status,
  });

  return {
    success: chargeResult.success,
    paymentId: payment.id,
    providerTransactionId: chargeResult.providerTransactionId,
    status: chargeResult.status,
    failureReason: chargeResult.failureReason,
  };
}
