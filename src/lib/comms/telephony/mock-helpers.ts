import type {
  SmsPort,
  TelephonyPort,
  SendSmsRequest,
  SendSmsResult,
  StartCallRequest,
  StartCallResult,
  TransferCallRequest,
  TransferCallResult,
} from "./types";

// Every telephony/SMS mock is built from these two factories — the same
// provable-contract pattern as ../../payments/mock-helpers.ts. A real
// TwilioAdapter doesn't ship until it passes the exact same contract suite
// (__tests__/contract.test.ts) these mocks already pass.
//
// FORCE_FAIL / FORCE_PENDING in a request's reference simulates the
// failure modes a real integration will hit — carrier rejection, queued
// delivery, dropped transfer — on purpose, per the payments README's
// guidance that mocks exercise failure paths, not just the happy path.
//
// Two failure modes are NOT simulated but structurally enforced on every
// adapter (mock and real), because they're compliance requirements, not
// provider behaviors:
//   1. SMS without a consentRef fails (TCPA — GLOBAL/05 §A).
//   2. startCall with recordCall=true but no recordingDisclosure fails
//      (recording-disclosure-in-every-call-path — GLOBAL/05 §A).

function simulatedId(providerName: string, kind: string): string {
  return `${providerName}_${kind}_${crypto.randomUUID()}`;
}

export function createMockSms(providerName: string): SmsPort {
  return {
    providerName,

    async sendSms(request: SendSmsRequest): Promise<SendSmsResult> {
      const providerMessageId = simulatedId(providerName, "sms");

      if (!request.consentRef) {
        return {
          success: false,
          providerMessageId,
          status: "failed",
          failureReason: "Refused: no consentRef (TCPA: no SMS without a consent row)",
          rawResponse: { provider: providerName, simulated: true, outcome: "consent_missing" },
        };
      }
      if (request.reference.includes("FORCE_FAIL")) {
        return {
          success: false,
          providerMessageId,
          status: "failed",
          failureReason: "Simulated carrier rejection (FORCE_FAIL present in reference)",
          rawResponse: { provider: providerName, simulated: true, outcome: "rejected" },
        };
      }
      if (request.reference.includes("FORCE_PENDING")) {
        return {
          success: false,
          providerMessageId,
          status: "pending",
          rawResponse: { provider: providerName, simulated: true, outcome: "queued" },
        };
      }
      return {
        success: true,
        providerMessageId,
        status: "sent",
        rawResponse: { provider: providerName, simulated: true, outcome: "delivered", to: request.to },
      };
    },
  };
}

export function createMockTelephony(providerName: string): TelephonyPort {
  return {
    providerName,

    async startCall(request: StartCallRequest): Promise<StartCallResult> {
      const providerCallId = simulatedId(providerName, "call");

      if (request.recordCall && !request.recordingDisclosure) {
        return {
          success: false,
          providerCallId,
          status: "failed",
          failureReason:
            "Refused: recordCall without recordingDisclosure (disclosure required in every call path)",
          rawResponse: { provider: providerName, simulated: true, outcome: "disclosure_missing" },
        };
      }
      if (request.reference.includes("FORCE_FAIL")) {
        return {
          success: false,
          providerCallId,
          status: "failed",
          failureReason: "Simulated call failure (FORCE_FAIL present in reference)",
          rawResponse: { provider: providerName, simulated: true, outcome: "failed" },
        };
      }
      if (request.reference.includes("FORCE_PENDING")) {
        return {
          success: false,
          providerCallId,
          status: "pending",
          rawResponse: { provider: providerName, simulated: true, outcome: "ringing" },
        };
      }
      return {
        success: true,
        providerCallId,
        status: "initiated",
        rawResponse: { provider: providerName, simulated: true, outcome: "initiated", to: request.to },
      };
    },

    async transferCall(request: TransferCallRequest): Promise<TransferCallResult> {
      if (request.reference.includes("FORCE_FAIL")) {
        return {
          success: false,
          providerCallId: request.providerCallId,
          status: "failed",
          failureReason: "Simulated dropped transfer (FORCE_FAIL present in reference)",
          rawResponse: { provider: providerName, simulated: true, outcome: "transfer_failed" },
        };
      }
      return {
        success: true,
        providerCallId: request.providerCallId,
        status: "transferred",
        rawResponse: { provider: providerName, simulated: true, outcome: "transferred", target: request.target },
      };
    },
  };
}
