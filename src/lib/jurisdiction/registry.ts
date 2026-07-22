import { env } from "@/config/env";
import type { JurisdictionCode, JurisdictionConfig } from "./types";
import { IN_JURISDICTION } from "./configs/in";
import { US_JURISDICTION } from "./configs/us";

// Lookup + helpers. Adding a country = adding a config file and a line
// here — never a branch in consumer code (../../jurisdiction/README.md
// "The Boundary Rule"). Each deployed instance sets JURISDICTION once
// (siringet-in → IN, siringet-us → US; GLOBAL/01 §A).

const CONFIGS: Record<JurisdictionCode, JurisdictionConfig> = {
  IN: IN_JURISDICTION,
  US: US_JURISDICTION,
};

export function getJurisdiction(code?: JurisdictionCode): JurisdictionConfig {
  const active = code ?? env.jurisdiction();
  const config = CONFIGS[active];
  if (!config) throw new Error(`Unknown JURISDICTION: ${active}`);
  return config;
}

export function formatCurrency(amount: number, code?: JurisdictionCode): string {
  const j = getJurisdiction(code);
  return new Intl.NumberFormat(j.locale, { style: "currency", currency: j.currency }).format(
    amount
  );
}

export function formatDate(date: Date, code?: JurisdictionCode): string {
  const j = getJurisdiction(code);
  return new Intl.DateTimeFormat(j.locale, {
    dateStyle: "medium",
    timeZone: j.timezoneDefault,
  }).format(date);
}

export function validateTaxId(kind: string, value: string, code?: JurisdictionCode): boolean {
  const j = getJurisdiction(code);
  const validator = j.taxIds.find((t) => t.kind === kind);
  if (!validator) throw new Error(`Unknown tax-ID kind "${kind}" for jurisdiction ${j.code}`);
  return validator.validate(value);
}

export function validatePostalCode(value: string, code?: JurisdictionCode): boolean {
  return getJurisdiction(code).address.postalCodePattern.test(value.trim());
}

export function getConsentPolicy(code?: JurisdictionCode) {
  return getJurisdiction(code).consent;
}

// Exposed for the contract-style suite: every registered jurisdiction is
// held to the same structural assertions (__tests__/jurisdiction.test.ts).
export const allJurisdictions = (): JurisdictionConfig[] => Object.values(CONFIGS);
