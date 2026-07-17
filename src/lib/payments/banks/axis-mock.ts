import { createMockBankPayout } from "../mock-helpers";

// Stand-in for a real Axis Bank payout integration — see icici-mock.ts for
// the swap-to-real contract this and every other bank mock follows.
export const axisMock = createMockBankPayout("axis-mock");
