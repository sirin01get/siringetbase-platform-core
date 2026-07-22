import type { JurisdictionConfig } from "../types";

// US policy as data (country-extension/usa/README.md; USVALUE/PMMUSA docs
// 03 §B1 and 04). First consumer: PMMUSA on the siringet-us instance.

const EIN = /^[0-9]{2}-?[0-9]{7}$/;
const SSN_LAST4 = /^[0-9]{4}$/;

// ABA routing number: 9 digits + checksum
// 3(d1+d4+d7) + 7(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10).
function validAbaRouting(value: string): boolean {
  const v = value.trim();
  if (!/^[0-9]{9}$/.test(v)) return false;
  const d = v.split("").map(Number) as number[];
  const sum =
    3 * (d[0]! + d[3]! + d[6]!) + 7 * (d[1]! + d[4]! + d[7]!) + (d[2]! + d[5]! + d[8]!);
  return sum % 10 === 0;
}

export const US_JURISDICTION: JurisdictionConfig = {
  code: "US",
  currency: "USD",
  locale: "en-US",
  timezoneDefault: "America/Chicago",
  address: {
    fields: [
      { name: "line1", label: "Street address", required: true },
      { name: "line2", label: "Apt / Suite / Unit", required: false },
      { name: "city", label: "City", required: true },
      { name: "state", label: "State", required: true },
      { name: "postalCode", label: "ZIP code", required: true },
    ],
    postalCodePattern: /^\d{5}(-\d{4})?$/,
    postalCodeLabel: "ZIP code",
  },
  taxIds: [
    // W-9 capture needs EIN or SSN-last-4 (USVALUE/PMMUSA/03 §B1); full
    // SSNs are deliberately NOT a validator here — the platform never
    // stores one (security tier posture).
    { kind: "ein", label: "EIN", validate: (v) => EIN.test(v.trim()) },
    { kind: "ssn_last4", label: "SSN (last 4)", validate: (v) => SSN_LAST4.test(v.trim()) },
    { kind: "aba_routing", label: "Routing number", validate: validAbaRouting },
  ],
  consent: {
    // No federal law — state opt-out model, CCPA/CPRA as the strictest
    // baseline (country-extension/README.md). TCPA SMS consent is a
    // separate, stricter channel-level requirement enforced in SmsPort.
    model: "opt-out",
    lawfulBases: ["consent", "legitimate_interest", "contract", "legal_obligation"],
    legitimateInterestAllowed: true,
    retentionDefaultDays: 730,
    obligations: ["do_not_sell_link", "tcpa_sms_consent", "tcpa_quiet_hours"],
  },
};
