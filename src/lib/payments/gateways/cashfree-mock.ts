import { createMockGateway } from "../mock-helpers";

// Stand-in for a real Cashfree integration — see razorpay-mock.ts for the
// swap-to-real contract this and every other gateway mock follows.
export const cashfreeMock = createMockGateway("cashfree-mock");
