// PaymentGatewayPort (collection) and BankPayoutPort (disbursement) — the
// two interfaces ../../payments/README.md specifies. Calling code depends
// on these interfaces only, never on a concrete provider — that's what
// makes swapping a mock for a real adapter later a config change, not a
// rewrite (see registry.ts).

export interface ChargeRequest {
  amount: number; // smallest currency unit avoided on purpose — this is
  // rupees as a decimal (numeric(12,2) in Postgres), not paise; kept
  // consistent with the DB column, revisit only if a real gateway forces paise.
  currency: string;
  roleProfileId: string;
  vertical: string;
  engagementId?: string;
  description: string; // mocks look for FORCE_FAIL / FORCE_PENDING here — see mock-helpers.ts
}

export interface ChargeResult {
  success: boolean;
  providerTransactionId: string;
  status: "completed" | "failed" | "pending";
  failureReason?: string;
  rawResponse: Record<string, unknown>;
}

export interface RefundRequest {
  providerTransactionId: string;
  amount: number;
  reason: string; // mocks look for FORCE_FAIL here
}

export interface RefundResult {
  success: boolean;
  providerTransactionId: string;
  status: "completed" | "failed";
  rawResponse: Record<string, unknown>;
}

export interface PaymentGatewayPort {
  readonly providerName: string;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
}

// Payout destination — discriminated by rail, per country-extension/usa
// ("payout_accounts needs a US bank account model (routing number +
// account number) instead of IFSC") and USVALUE/PMMUSA/03 §B3's
// payout_accounts account-type discriminator. Adding a rail (SEPA
// IBAN/BIC, AU BSB, …) is a new union member + migration, never a change
// to callers that don't use it. Mirrors supabase migration
// 0011_payout_account_types.sql's account_type column.
export type PayoutDestination =
  | { accountType: "in_ifsc"; ifsc: string }
  | { accountType: "us_ach"; routingNumber: string };

export interface PayoutRequest {
  amount: number;
  currency: string;
  payoutAccountId: string;
  accountNumberLast4: string;
  destination: PayoutDestination;
  accountHolderName: string;
  reference: string; // mocks look for FORCE_FAIL here
}

export interface PayoutResult {
  success: boolean;
  providerTransactionId: string;
  status: "completed" | "failed" | "pending";
  failureReason?: string;
  rawResponse: Record<string, unknown>;
}

export interface BankPayoutPort {
  readonly providerName: string;
  disburse(request: PayoutRequest): Promise<PayoutResult>;
}
