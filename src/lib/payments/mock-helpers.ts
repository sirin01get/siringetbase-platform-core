import type {
  PaymentGatewayPort,
  BankPayoutPort,
  ChargeRequest,
  ChargeResult,
  RefundRequest,
  RefundResult,
  PayoutRequest,
  PayoutResult,
  MandateRequest,
  MandateResult,
  MandateChargeRequest,
} from "./types";

// Every gateway/bank mock is built from these two factories, so they're
// provably identical in contract — the actual point of "mock now, real
// later" (../../payments/README.md) is that swapping one adapter for a real
// integration is safe specifically because every adapter passes the exact
// same shape of request/response. A real RazorpayAdapter doesn't ship until
// it satisfies the same contract this mock already does.
//
// FORCE_FAIL / FORCE_PENDING in a request's description/reason/reference
// simulates the failure modes a real integration will actually hit —
// declined charges, pending settlement, failed NEFT/IMPS — on purpose, per
// that doc's guidance that mocks should exercise failure paths, not just
// the happy path.

function simulatedTransactionId(providerName: string): string {
  return `${providerName}_${crypto.randomUUID()}`;
}

export function createMockGateway(providerName: string): PaymentGatewayPort {
  return {
    providerName,

    async charge(request: ChargeRequest): Promise<ChargeResult> {
      const providerTransactionId = simulatedTransactionId(providerName);

      if (request.description.includes("FORCE_FAIL")) {
        return {
          success: false,
          providerTransactionId,
          status: "failed",
          failureReason: "Simulated decline (FORCE_FAIL present in description)",
          rawResponse: { provider: providerName, simulated: true, outcome: "declined" },
        };
      }
      if (request.description.includes("FORCE_PENDING")) {
        return {
          success: false,
          providerTransactionId,
          status: "pending",
          rawResponse: { provider: providerName, simulated: true, outcome: "pending" },
        };
      }
      return {
        success: true,
        providerTransactionId,
        status: "completed",
        rawResponse: { provider: providerName, simulated: true, outcome: "success", amount: request.amount },
      };
    },

    async refund(request: RefundRequest): Promise<RefundResult> {
      const providerTransactionId = simulatedTransactionId(providerName);

      if (request.reason.includes("FORCE_FAIL")) {
        return {
          success: false,
          providerTransactionId,
          status: "failed",
          rawResponse: { provider: providerName, simulated: true, outcome: "refund_failed" },
        };
      }
      return {
        success: true,
        providerTransactionId,
        status: "completed",
        rawResponse: { provider: providerName, simulated: true, outcome: "refunded", amount: request.amount },
      };
    },

    // Recurring-billing extension — see ./types.ts's header comment on
    // MandateRequest/MandateChargeRequest for why these are separate from
    // charge()/refund() above. Same FORCE_FAIL/FORCE_PENDING convention,
    // read from `description` on both calls.
    async createMandate(request: MandateRequest): Promise<MandateResult> {
      const mandateReference = `mandate_${providerName}_${crypto.randomUUID()}`;

      if (request.description.includes("FORCE_FAIL")) {
        return {
          success: false,
          mandateReference,
          status: "failed",
          failureReason: "Simulated mandate setup decline (FORCE_FAIL present in description)",
          rawResponse: { provider: providerName, simulated: true, outcome: "mandate_declined" },
        };
      }
      if (request.description.includes("FORCE_PENDING")) {
        return {
          success: false,
          mandateReference,
          status: "pending",
          rawResponse: { provider: providerName, simulated: true, outcome: "mandate_pending" },
        };
      }
      return {
        success: true,
        mandateReference,
        status: "active",
        rawResponse: { provider: providerName, simulated: true, outcome: "mandate_active" },
      };
    },

    async chargeMandate(request: MandateChargeRequest): Promise<ChargeResult> {
      const providerTransactionId = simulatedTransactionId(providerName);

      if (request.description.includes("FORCE_FAIL")) {
        return {
          success: false,
          providerTransactionId,
          status: "failed",
          failureReason: "Simulated mandate draw decline (FORCE_FAIL present in description)",
          rawResponse: { provider: providerName, simulated: true, outcome: "mandate_charge_declined" },
        };
      }
      if (request.description.includes("FORCE_PENDING")) {
        return {
          success: false,
          providerTransactionId,
          status: "pending",
          rawResponse: { provider: providerName, simulated: true, outcome: "mandate_charge_pending" },
        };
      }
      return {
        success: true,
        providerTransactionId,
        status: "completed",
        rawResponse: { provider: providerName, simulated: true, outcome: "mandate_charge_success", amount: request.amount },
      };
    },
  };
}

export function createMockBankPayout(providerName: string): BankPayoutPort {
  return {
    providerName,

    async disburse(request: PayoutRequest): Promise<PayoutResult> {
      const providerTransactionId = simulatedTransactionId(providerName);

      if (request.reference.includes("FORCE_FAIL")) {
        return {
          success: false,
          providerTransactionId,
          status: "failed",
          failureReason: "Simulated NEFT/IMPS failure (FORCE_FAIL present in reference)",
          rawResponse: { provider: providerName, simulated: true, outcome: "failed" },
        };
      }
      return {
        success: true,
        providerTransactionId,
        status: "completed",
        rawResponse: { provider: providerName, simulated: true, outcome: "success", amount: request.amount },
      };
    },
  };
}
