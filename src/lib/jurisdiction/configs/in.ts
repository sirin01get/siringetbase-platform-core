import type { JurisdictionConfig } from "../types";

// India policy as data — extracted from what cafocus/buildfocus already do
// implicitly (INR, PAN/IFSC/GSTIN, DPDP consent-only opt-in), so existing
// verticals can migrate to reading it from here opportunistically
// (../../../../jurisdiction/README.md "Consumed By").

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const IN_JURISDICTION: JurisdictionConfig = {
  code: "IN",
  currency: "INR",
  locale: "en-IN",
  timezoneDefault: "Asia/Kolkata",
  address: {
    fields: [
      { name: "line1", label: "Address line 1", required: true },
      { name: "line2", label: "Address line 2", required: false },
      { name: "city", label: "City", required: true },
      { name: "state", label: "State", required: true },
      { name: "postalCode", label: "PIN code", required: true },
    ],
    postalCodePattern: /^[1-9][0-9]{5}$/,
    postalCodeLabel: "PIN code",
  },
  taxIds: [
    { kind: "pan", label: "PAN", validate: (v) => PAN.test(v.trim().toUpperCase()) },
    { kind: "ifsc", label: "IFSC", validate: (v) => IFSC.test(v.trim().toUpperCase()) },
    { kind: "gstin", label: "GSTIN", validate: (v) => GSTIN.test(v.trim().toUpperCase()) },
  ],
  consent: {
    // DPDP Act 2023: consent-only, no legitimate-interest basis
    // (country-extension/README.md comparison table).
    model: "opt-in",
    lawfulBases: ["consent"],
    legitimateInterestAllowed: false,
    retentionDefaultDays: 365,
    obligations: ["consent_ledger_before_write"],
  },
};
