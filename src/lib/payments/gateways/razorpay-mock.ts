import { createMockGateway } from "../mock-helpers";

// Stand-in for a real Razorpay integration. Swapping this for
// `razorpay-adapter.ts` later means: implement PaymentGatewayPort against
// the real Razorpay API, pass the same contract tests this mock passes,
// flip PAYMENT_GATEWAY_PROVIDER — no change to registry.ts's callers.
export const razorpayMock = createMockGateway("razorpay-mock");
