import type {
  GstGatewayPort,
  GstConnectRequest,
  GstConnectResult,
  GstPushReturnRequest,
  GstPushReturnResult,
  GstReturnStatusRequest,
  GstReturnStatusResult,
} from "./types";

// Every GSP mock is built from this one factory, so any future GSP-specific
// mock is provably identical in contract — the point of "mock now, real
// later" (../../gst-gsp/README.md) is that swapping this adapter for a real
// GSP integration is safe specifically because every adapter passes the
// exact same shape of request/response. A real adapter doesn't ship until
// it satisfies the same contract this mock already does.
//
// FORCE_FAIL / FORCE_PENDING in a request's consentNote/submissionNote
// simulates the failure modes a real GSP integration will actually hit —
// expired consent, GSTIN mismatch, GSTN downtime — on purpose, per that
// doc's guidance that mocks should exercise failure paths, not just the
// happy path.

const GSTIN_PATTERN = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/;

function simulatedReference(prefix: string, providerName: string): string {
  return `${prefix}_${providerName}_${crypto.randomUUID()}`;
}

export function createMockGstGateway(providerName: string): GstGatewayPort {
  return {
    providerName,

    async connect(request: GstConnectRequest): Promise<GstConnectResult> {
      const connectionReference = simulatedReference("gstconn", providerName);

      if (!GSTIN_PATTERN.test(request.gstin)) {
        return {
          success: false,
          connectionReference,
          status: "failed",
          failureReason: "Malformed GSTIN — doesn't match the 15-character GSTIN format.",
          rawResponse: { provider: providerName, simulated: true, outcome: "invalid_gstin" },
        };
      }
      if (request.consentNote.includes("FORCE_FAIL")) {
        return {
          success: false,
          connectionReference,
          status: "failed",
          failureReason: "Simulated consent denial (FORCE_FAIL present in consentNote)",
          rawResponse: { provider: providerName, simulated: true, outcome: "consent_denied" },
        };
      }
      if (request.consentNote.includes("FORCE_PENDING")) {
        return {
          success: false,
          connectionReference,
          status: "pending",
          rawResponse: { provider: providerName, simulated: true, outcome: "consent_pending" },
        };
      }
      return {
        success: true,
        connectionReference,
        status: "connected",
        rawResponse: { provider: providerName, simulated: true, outcome: "connected", gstin: request.gstin },
      };
    },

    async pushReturn(request: GstPushReturnRequest): Promise<GstPushReturnResult> {
      const pushReference = simulatedReference("gstpush", providerName);

      if (request.submissionNote.includes("FORCE_FAIL")) {
        return {
          success: false,
          pushReference,
          status: "failed",
          failureReason: "Simulated GSTN rejection (FORCE_FAIL present in submissionNote)",
          rawResponse: { provider: providerName, simulated: true, outcome: "rejected" },
        };
      }
      if (request.submissionNote.includes("FORCE_PENDING")) {
        return {
          success: false,
          pushReference,
          status: "pending",
          rawResponse: { provider: providerName, simulated: true, outcome: "gstn_pending" },
        };
      }
      return {
        success: true,
        pushReference,
        status: "submitted",
        rawResponse: { provider: providerName, simulated: true, outcome: "submitted", period: request.period },
      };
    },

    // Deterministic: a mock push reference always reports "filed" once
    // polled, so the workbench UI's happy path (push -> poll -> show filed)
    // can be exercised without a second simulated-failure convention here —
    // the failure/pending cases are already exercised at pushReturn() time,
    // same as a real GSP wouldn't accept a submission it's later going to
    // silently reject at the status-poll stage.
    async getReturnStatus(request: GstReturnStatusRequest): Promise<GstReturnStatusResult> {
      return {
        pushReference: request.pushReference,
        status: "filed",
        gspAcknowledgmentNumber: `ACK${request.pushReference.slice(-10).toUpperCase()}`,
        rawResponse: { provider: providerName, simulated: true, outcome: "filed" },
      };
    },
  };
}
