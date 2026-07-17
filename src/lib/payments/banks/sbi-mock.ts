import { createMockBankPayout } from "../mock-helpers";

// Stand-in for a real State Bank of India payout integration — see
// icici-mock.ts for the swap-to-real contract every bank mock follows.
export const sbiMock = createMockBankPayout("sbi-mock");
