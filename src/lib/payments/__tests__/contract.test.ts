import { describe, expect, it } from "vitest";
import { allPaymentGateways, allBankPayouts } from "../registry";
import type { ChargeRequest, PayoutRequest, PayoutDestination } from "../types";

// One contract suite per port, run against EVERY adapter — the
// payments/README.md "Mock-to-Real" rule made executable (it existed as
// prose before PMMUSA WO3; the real Stripe/ACH adapters ship only when
// they pass this exact suite). Both rails are exercised against every
// BankPayoutPort adapter: the port is rail-agnostic by contract.

const chargeRequest = (overrides: Partial<ChargeRequest> = {}): ChargeRequest => ({
  amount: 1000,
  currency: "INR",
  roleProfileId: "rp_test",
  vertical: "contract-test",
  description: "contract test charge",
  ...overrides,
});

const DESTINATIONS: PayoutDestination[] = [
  { accountType: "in_ifsc", ifsc: "HDFC0001234" },
  { accountType: "us_ach", routingNumber: "021000021" },
];

const payoutRequest = (
  destination: PayoutDestination,
  overrides: Partial<PayoutRequest> = {}
): PayoutRequest => ({
  amount: 900,
  currency: destination.accountType === "us_ach" ? "USD" : "INR",
  payoutAccountId: "pa_test",
  accountNumberLast4: "1234",
  destination,
  accountHolderName: "Contract Test",
  reference: "contract_test_payout",
  ...overrides,
});

for (const gateway of allPaymentGateways()) {
  describe(`PaymentGatewayPort contract: ${gateway.providerName}`, () => {
    it("charges successfully", async () => {
      const result = await gateway.charge(chargeRequest());
      expect(result.success).toBe(true);
      expect(result.status).toBe("completed");
      expect(result.providerTransactionId).toBeTruthy();
    });

    it("reports a declined charge without throwing", async () => {
      const result = await gateway.charge(chargeRequest({ description: "FORCE_FAIL" }));
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.failureReason).toBeTruthy();
    });

    it("reports a pending charge as not-success", async () => {
      const result = await gateway.charge(chargeRequest({ description: "FORCE_PENDING" }));
      expect(result.success).toBe(false);
      expect(result.status).toBe("pending");
    });

    it("refunds a completed charge", async () => {
      const charge = await gateway.charge(chargeRequest());
      const refund = await gateway.refund({
        providerTransactionId: charge.providerTransactionId,
        amount: 1000,
        reason: "contract test refund",
      });
      expect(refund.success).toBe(true);
      expect(refund.status).toBe("completed");
    });

    it("reports a failed refund without throwing", async () => {
      const refund = await gateway.refund({
        providerTransactionId: "tx_x",
        amount: 1000,
        reason: "FORCE_FAIL",
      });
      expect(refund.success).toBe(false);
      expect(refund.status).toBe("failed");
    });
  });
}

for (const bank of allBankPayouts()) {
  for (const destination of DESTINATIONS) {
    describe(`BankPayoutPort contract: ${bank.providerName} → ${destination.accountType}`, () => {
      it("disburses successfully", async () => {
        const result = await bank.disburse(payoutRequest(destination));
        expect(result.success).toBe(true);
        expect(result.status).toBe("completed");
        expect(result.providerTransactionId).toBeTruthy();
      });

      it("reports a failed transfer without throwing", async () => {
        const result = await bank.disburse(
          payoutRequest(destination, { reference: "FORCE_FAIL" })
        );
        expect(result.success).toBe(false);
        expect(result.status).toBe("failed");
        expect(result.failureReason).toBeTruthy();
      });
    });
  }
}
