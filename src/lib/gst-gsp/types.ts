// GstGatewayPort — the single interface ../../gst-gsp/README.md specifies.
// Calling code depends on this interface only, never on a concrete GSP —
// that's what makes swapping the mock for a real adapter later a config
// change, not a rewrite (see registry.ts). Mirrors ../payments/types.ts's
// PaymentGatewayPort shape deliberately, since this is the same
// mock-then-real port pattern applied to a different rail.

export interface GstConnectRequest {
  gstin: string;
  organizationId: string;
  vertical: string;
  // mocks look for FORCE_FAIL here — see mock-helpers.ts. Not a real field
  // GSTN/a GSP would accept; a deliberate test-only convention, same as
  // ../payments/types.ts's ChargeRequest.description.
  consentNote: string;
}

export interface GstConnectResult {
  success: boolean;
  connectionReference: string;
  status: "connected" | "failed" | "pending";
  failureReason?: string;
  rawResponse: Record<string, unknown>;
}

export interface GstPushReturnRequest {
  connectionReference: string;
  period: string; // e.g. "Q1-FY2026" — matches cafocus.filings.period's shape, not GSTN's own period code, which a real adapter would translate
  returnData: Record<string, unknown>; // the rollup.ts-shaped payload — see ../../gst-gsp/README.md's "consumed by"
  // mocks look for FORCE_FAIL / FORCE_PENDING here
  submissionNote: string;
}

export interface GstPushReturnResult {
  success: boolean;
  pushReference: string;
  status: "submitted" | "failed" | "pending";
  failureReason?: string;
  rawResponse: Record<string, unknown>;
}

export interface GstReturnStatusRequest {
  pushReference: string;
}

export interface GstReturnStatusResult {
  pushReference: string;
  status: "queued" | "submitted" | "filed" | "rejected";
  gspAcknowledgmentNumber?: string;
  rawResponse: Record<string, unknown>;
}

export interface GstGatewayPort {
  readonly providerName: string;
  connect(request: GstConnectRequest): Promise<GstConnectResult>;
  pushReturn(request: GstPushReturnRequest): Promise<GstPushReturnResult>;
  getReturnStatus(request: GstReturnStatusRequest): Promise<GstReturnStatusResult>;
}
