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

// Recurring-billing extension — a mandate is a stored auto-debit
// authorization (Razorpay/Cashfree/PayU e-mandate / UPI Autopay in a real
// integration); chargeMandate() draws against an already-created one on a
// cadence. This is separate from charge()/refund() because a mandate has
// its own lifecycle (create once, charge many times, can fail/lapse
// independently of any single charge) — see
// ../../../../cafocus/app/src/lib/subscriptions/ for the caller
// (module-subscription recurring billing, "auto-renew" mode).
export interface MandateRequest {
  roleProfileId: string;
  vertical: string;
  description: string; // mocks look for FORCE_FAIL / FORCE_PENDING here — see mock-helpers.ts
}

export interface MandateResult {
  success: boolean;
  mandateReference: string;
  status: "active" | "failed" | "pending";
  failureReason?: string;
  rawResponse: Record<string, unknown>;
}

export interface MandateChargeRequest {
  mandateReference: string;
  amount: number;
  currency: string;
  description: string; // mocks look for FORCE_FAIL / FORCE_PENDING here
}

export interface PaymentGatewayPort {
  readonly providerName: string;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  createMandate(request: MandateRequest): Promise<MandateResult>;
  // Reuses ChargeResult — a mandate draw is a charge in every way that
  // matters to a caller, it just authenticates differently than charge().
  chargeMandate(request: MandateChargeRequest): Promise<ChargeResult>;
}

export interface PayoutRequest {
  amount: number;
  currency: string;
  payoutAccountId: string;
  accountNumberLast4: string;
  ifsc: string;
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
