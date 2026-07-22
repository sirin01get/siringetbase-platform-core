// TelephonyPort (voice) and SmsPort (text) — the two new generic comms
// ports USVALUE/PMMUSA/01-infrastructure.md Gap 1 specifies, living beside
// ../types.ts's EmailSenderPort with the exact same discipline as
// ../../payments/types.ts: calling code depends on these interfaces only,
// never on Twilio/Telnyx directly, so swapping providers (Telnyx is the
// cheaper fallback per that doc) is a registry/config change, not a
// rewrite. Voice and SMS are as generic as email — nothing PM-specific
// belongs here (USVALUE/PMMUSA/03-siringetbase-reuse.md §B2).

// ---------------------------------------------------------------------------
// SmsPort
// ---------------------------------------------------------------------------

export interface SendSmsRequest {
  to: string; // E.164, e.g. "+15551234567"
  vertical: string;
  role: string;
  // TCPA discipline (USVALUE/PMMUSA/04-us-compliance.md; GLOBAL/05 §A
  // "Compliance tests: no SMS without consent row"): every send carries a
  // reference to the consent record that authorizes it. Adapters MUST
  // refuse to send when this is empty — enforced structurally in the port
  // contract (see contract tests), not left to calling-code discipline.
  consentRef: string;
  body: string;
  engagementId?: string;
  reference: string; // mocks look for FORCE_FAIL / FORCE_PENDING here — see mock-helpers.ts
}

export interface SendSmsResult {
  success: boolean;
  providerMessageId: string;
  status: "sent" | "failed" | "pending";
  failureReason?: string;
  rawResponse: Record<string, unknown>;
}

export interface SmsPort {
  readonly providerName: string;
  sendSms(request: SendSmsRequest): Promise<SendSmsResult>;
}

// ---------------------------------------------------------------------------
// TelephonyPort
// ---------------------------------------------------------------------------

export interface StartCallRequest {
  to: string; // E.164
  from: string; // provisioned number for the vertical/firm
  vertical: string;
  engagementId?: string;
  // Recording disclosure is a call-path compliance requirement
  // (GLOBAL/05 §A: "recording disclosure present in every call path").
  // The port makes it explicit so no adapter can silently record without it.
  recordCall: boolean;
  recordingDisclosure?: string; // required when recordCall is true
  reference: string; // mocks look for FORCE_FAIL / FORCE_PENDING here
}

export interface StartCallResult {
  success: boolean;
  providerCallId: string;
  status: "initiated" | "failed" | "pending";
  failureReason?: string;
  rawResponse: Record<string, unknown>;
}

export interface TransferCallRequest {
  providerCallId: string;
  // Warm transfer target — India ops coordinator via SIP or PSTN
  // (USVALUE/PMMUSA/01-infrastructure.md Gap 1: "warm transfer to India
  // ops via SIP/WebRTC"). The port doesn't care which.
  target: string; // sip: URI or E.164
  reference: string; // mocks look for FORCE_FAIL here
}

export interface TransferCallResult {
  success: boolean;
  providerCallId: string;
  status: "transferred" | "failed";
  failureReason?: string;
  rawResponse: Record<string, unknown>;
}

export interface TelephonyPort {
  readonly providerName: string;
  startCall(request: StartCallRequest): Promise<StartCallResult>;
  transferCall(request: TransferCallRequest): Promise<TransferCallResult>;
}
