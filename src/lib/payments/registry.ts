import { env } from "@/config/env";
import type { PaymentGatewayPort, BankPayoutPort } from "./types";
import { razorpayMock } from "./gateways/razorpay-mock";
import { payuMock } from "./gateways/payu-mock";
import { cashfreeMock } from "./gateways/cashfree-mock";
import { stripeMock } from "./gateways/stripe-mock";
import { iciciMock } from "./banks/icici-mock";
import { hdfcMock } from "./banks/hdfc-mock";
import { axisMock } from "./banks/axis-mock";
import { sbiMock } from "./banks/sbi-mock";
import { achMock } from "./banks/ach-mock";

const GATEWAYS: Record<string, PaymentGatewayPort> = {
  "razorpay-mock": razorpayMock,
  "payu-mock": payuMock,
  "cashfree-mock": cashfreeMock,
  "stripe-mock": stripeMock, // US instance (siringet-us) default
};

const BANK_PAYOUTS: Record<string, BankPayoutPort> = {
  "icici-mock": iciciMock,
  "hdfc-mock": hdfcMock,
  "axis-mock": axisMock,
  "sbi-mock": sbiMock,
  "ach-mock": achMock, // US instance (siringet-us) default
};

// The ONLY place calling code should ever look up which adapter is active.
// escrow.ts and every future caller depend on PaymentGatewayPort /
// BankPayoutPort, never on a provider name — that's what makes swapping a
// mock for a real adapter later a one-line env change here, not a rewrite
// anywhere else (../../payments/README.md's "Mock-to-Real" contract).
export function getPaymentGateway(): PaymentGatewayPort {
  const provider = env.paymentGatewayProvider();
  const gateway = GATEWAYS[provider];
  if (!gateway) throw new Error(`Unknown PAYMENT_GATEWAY_PROVIDER: ${provider}`);
  return gateway;
}

export function getBankPayout(): BankPayoutPort {
  const provider = env.bankPayoutProvider();
  const bank = BANK_PAYOUTS[provider];
  if (!bank) throw new Error(`Unknown BANK_PAYOUT_PROVIDER: ${provider}`);
  return bank;
}

// Exposed for the contract suite (__tests__/contract.test.ts): every
// registered adapter — mock and, later, real — must pass the same tests.
export const allPaymentGateways = (): PaymentGatewayPort[] => Object.values(GATEWAYS);
export const allBankPayouts = (): BankPayoutPort[] => Object.values(BANK_PAYOUTS);
