import { createMockGateway } from "../mock-helpers";

// Stand-in for a real PayU integration — see razorpay-mock.ts for the
// swap-to-real contract this and every other gateway mock follows.
export const payuMock = createMockGateway("payu-mock");
