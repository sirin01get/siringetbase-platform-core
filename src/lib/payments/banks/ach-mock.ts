import { createMockBankPayout } from "../mock-helpers";

// Stand-in for US vendor payouts — ACH transfers via Stripe Connect
// (USVALUE/PMMUSA/01-infrastructure.md Gap 2), behind the same
// BankPayoutPort the India NEFT/IMPS mocks implement. Destination is a
// routing+account row (payments/types.ts PayoutDestination "us_ach";
// payout_accounts migration 0011). Same swap rule: the real adapter ships
// only when it passes the same contract suite.
export const achMock = createMockBankPayout("ach-mock");
