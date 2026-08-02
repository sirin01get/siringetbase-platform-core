import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getGstGateway } from "./registry";

// connect / pushReturn / getReturnStatus — the three primitives
// ../../gst-gsp/README.md specifies. cafocus/app's filing workbench calls
// these once a filing's rollup (cafocus's src/lib/gst/rollup.ts) is ready;
// nothing filing-workflow-specific lives here, mirroring
// ../payments/escrow.ts's split between generic rail mechanics (this file)
// and vertical-specific meaning (the calling vertical's own service layer).

export interface ConnectGstinParams {
  organizationId: string;
  vertical: string;
  gstin: string;
  consentNote?: string; // FORCE_FAIL / FORCE_PENDING test hook — see ../gst-gsp/mock-helpers.ts
}

export interface ConnectGstinResult {
  success: boolean;
  connectionId?: string;
  connectionReference: string;
  status: "connected" | "failed" | "pending";
  failureReason?: string;
}

export async function connectGstin(params: ConnectGstinParams): Promise<ConnectGstinResult> {
  const supabase = createSupabaseServiceRoleClient();
  const gateway = getGstGateway();

  const connectResult = await gateway.connect({
    gstin: params.gstin,
    organizationId: params.organizationId,
    vertical: params.vertical,
    consentNote: params.consentNote ?? "",
  });

  const { data: connection, error } = await supabase
    .from("gst_connections")
    .insert({
      organization_id: params.organizationId,
      vertical: params.vertical,
      gstin: params.gstin,
      provider: gateway.providerName,
      connection_reference: connectResult.connectionReference,
      status: connectResult.status,
    })
    .select()
    .single();

  if (error || !connection) throw new Error(`Failed to record GST connection: ${error?.message}`);

  return {
    success: connectResult.success,
    connectionId: connection.id,
    connectionReference: connectResult.connectionReference,
    status: connectResult.status,
    failureReason: connectResult.failureReason,
  };
}

export interface PushGstReturnParams {
  connectionId: string;
  filingId?: string;
  period: string;
  returnData: Record<string, unknown>; // the rollup.ts-shaped payload
  submissionNote?: string; // FORCE_FAIL / FORCE_PENDING test hook
}

export interface PushGstReturnResult {
  success: boolean;
  pushId?: string;
  pushReference: string;
  status: "submitted" | "failed" | "pending";
  failureReason?: string;
}

export async function pushGstReturn(params: PushGstReturnParams): Promise<PushGstReturnResult> {
  const supabase = createSupabaseServiceRoleClient();
  const gateway = getGstGateway();

  const { data: connection, error: connectionError } = await supabase
    .from("gst_connections")
    .select("*")
    .eq("id", params.connectionId)
    .single();

  if (connectionError || !connection) throw new Error(`GST connection not found: ${params.connectionId}`);
  if (connection.status !== "connected") {
    throw new Error(`GST connection ${params.connectionId} is not connected (currently: ${connection.status})`);
  }

  const pushResult = await gateway.pushReturn({
    connectionReference: connection.connection_reference,
    period: params.period,
    returnData: params.returnData,
    submissionNote: params.submissionNote ?? "",
  });

  const { data: push, error: pushError } = await supabase
    .from("gst_return_pushes")
    .insert({
      gst_connection_id: connection.id,
      filing_id: params.filingId ?? null,
      period: params.period,
      push_reference: pushResult.pushReference,
      status: pushResult.status,
    })
    .select()
    .single();

  if (pushError || !push) throw new Error(`Failed to record GST return push: ${pushError?.message}`);

  await supabase.from("provider_transactions").insert({
    gst_return_push_id: push.id,
    provider: gateway.providerName,
    provider_transaction_id: pushResult.pushReference,
    request_snapshot: { ...params },
    response_snapshot: pushResult.rawResponse,
    status: pushResult.status,
  });

  return {
    success: pushResult.success,
    pushId: push.id,
    pushReference: pushResult.pushReference,
    status: pushResult.status,
    failureReason: pushResult.failureReason,
  };
}

export interface GetGstReturnStatusResult {
  pushReference: string;
  status: "queued" | "submitted" | "filed" | "rejected";
  gspAcknowledgmentNumber?: string;
}

export async function getGstReturnStatus(pushId: string): Promise<GetGstReturnStatusResult> {
  const supabase = createSupabaseServiceRoleClient();
  const gateway = getGstGateway();

  const { data: push, error: pushError } = await supabase
    .from("gst_return_pushes")
    .select("*")
    .eq("id", pushId)
    .single();

  if (pushError || !push) throw new Error(`GST return push not found: ${pushId}`);

  const statusResult = await gateway.getReturnStatus({ pushReference: push.push_reference });

  await supabase
    .from("gst_return_pushes")
    .update({
      status: statusResult.status,
      gsp_acknowledgment_number: statusResult.gspAcknowledgmentNumber ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", push.id);

  return {
    pushReference: statusResult.pushReference,
    status: statusResult.status,
    gspAcknowledgmentNumber: statusResult.gspAcknowledgmentNumber,
  };
}
