import { createMockBankPayout } from "../mock-helpers";

// Stand-in for a real ICICI payout/disbursement integration. Swapping this
// for a real adapter means: implement BankPayoutPort against ICICI's real
// payout API, pass the same contract tests, flip BANK_PAYOUT_PROVIDER — no
// change to registry.ts's callers.
export const iciciMock = createMockBankPayout("icici-mock");
