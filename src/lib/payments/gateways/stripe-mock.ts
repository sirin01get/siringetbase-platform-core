import { createMockGateway } from "../mock-helpers";

// Stand-in for the real Stripe integration the US instance uses
// (USVALUE/PMMUSA/01-infrastructure.md Gap 2: Stripe Connect keeps the
// platform out of money-transmitter licensing; maintenance payments only,
// never rent money — doc 04). Swapping this for `stripe.ts` (test mode
// first) means: implement PaymentGatewayPort against the real Stripe API,
// pass the same contract tests this mock passes, flip
// PAYMENT_GATEWAY_PROVIDER — no change to any caller.
export const stripeMock = createMockGateway("stripe-mock");
