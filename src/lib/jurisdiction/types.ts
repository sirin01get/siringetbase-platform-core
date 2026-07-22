// Jurisdiction subsystem — generic mechanism, per-country policy as data
// (../../jurisdiction/README.md; country-extension/README.md's one
// recommended pre-second-country extraction). No consumer ever branches on
// a country code — it asks the active JurisdictionConfig instead.

export type JurisdictionCode = "IN" | "US";

export interface AddressField {
  name: string; // e.g. "line1", "city", "state", "postalCode"
  label: string;
  required: boolean;
}

export interface AddressFormat {
  fields: AddressField[];
  // e.g. IN PIN "^[1-9][0-9]{5}$", US ZIP "^\d{5}(-\d{4})?$"
  postalCodePattern: RegExp;
  postalCodeLabel: string; // "PIN code" vs "ZIP code"
}

export interface TaxIdValidator {
  kind: string; // e.g. "pan", "ifsc", "gstin", "ein", "ssn_last4", "aba_routing"
  label: string;
  validate(value: string): boolean;
}

// The consent-policy registry country-extension/README.md specifies: "what
// lawful bases exist, is legitimate-interest allowed, what's the retention
// default" — served as data, not duplicated in every vertical's
// user-analytics integration. IN = DPDP opt-in/consent-only; US = state
// opt-out model (CCPA/CPRA baseline).
export interface ConsentPolicy {
  model: "opt-in" | "opt-out";
  lawfulBases: string[]; // e.g. ["consent"] vs ["consent", "legitimate_interest", ...]
  legitimateInterestAllowed: boolean;
  retentionDefaultDays: number;
  // Extra per-jurisdiction obligations consumers must surface, as data —
  // e.g. US: "do_not_sell_link" (CCPA), quiet-hours windows for SMS (TCPA).
  obligations: string[];
}

export interface JurisdictionConfig {
  code: JurisdictionCode;
  currency: string; // ISO 4217
  locale: string; // BCP 47, drives Intl formatting
  timezoneDefault: string;
  address: AddressFormat;
  taxIds: TaxIdValidator[];
  consent: ConsentPolicy;
}
