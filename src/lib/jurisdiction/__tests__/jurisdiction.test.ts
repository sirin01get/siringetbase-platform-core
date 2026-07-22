import { describe, expect, it } from "vitest";
import {
  allJurisdictions,
  formatCurrency,
  getConsentPolicy,
  validatePostalCode,
  validateTaxId,
} from "../registry";

// Structural contract: every registered jurisdiction is complete — a new
// country config can't ship half-filled (same "same suite for every
// adapter" posture as the port contract tests).
for (const j of allJurisdictions()) {
  describe(`Jurisdiction completeness: ${j.code}`, () => {
    it("has currency, locale, timezone", () => {
      expect(j.currency).toMatch(/^[A-Z]{3}$/);
      expect(j.locale).toBeTruthy();
      expect(j.timezoneDefault).toBeTruthy();
    });
    it("has a usable address format", () => {
      expect(j.address.fields.length).toBeGreaterThan(0);
      expect(j.address.postalCodeLabel).toBeTruthy();
    });
    it("has at least one tax-ID validator", () => {
      expect(j.taxIds.length).toBeGreaterThan(0);
    });
    it("has a coherent consent policy", () => {
      expect(["opt-in", "opt-out"]).toContain(j.consent.model);
      expect(j.consent.lawfulBases.length).toBeGreaterThan(0);
      expect(j.consent.legitimateInterestAllowed).toBe(
        j.consent.lawfulBases.includes("legitimate_interest")
      );
    });
  });
}

describe("US policy", () => {
  it("formats USD in en-US", () => {
    expect(formatCurrency(1234.5, "US")).toBe("$1,234.50");
  });
  it("validates EIN", () => {
    expect(validateTaxId("ein", "12-3456789", "US")).toBe(true);
    expect(validateTaxId("ein", "123456789", "US")).toBe(true);
    expect(validateTaxId("ein", "12-34567", "US")).toBe(false);
  });
  it("validates SSN last-4 only (never a full SSN)", () => {
    expect(validateTaxId("ssn_last4", "1234", "US")).toBe(true);
    expect(validateTaxId("ssn_last4", "123-45-6789", "US")).toBe(false);
  });
  it("validates ABA routing numbers by checksum", () => {
    expect(validateTaxId("aba_routing", "021000021", "US")).toBe(true); // JPMorgan Chase NY
    expect(validateTaxId("aba_routing", "021000022", "US")).toBe(false); // checksum off by one
    expect(validateTaxId("aba_routing", "12345678", "US")).toBe(false);
  });
  it("validates ZIP and ZIP+4", () => {
    expect(validatePostalCode("60601", "US")).toBe(true);
    expect(validatePostalCode("60601-1234", "US")).toBe(true);
    expect(validatePostalCode("6060", "US")).toBe(false);
  });
  it("is an opt-out model with TCPA obligations", () => {
    const policy = getConsentPolicy("US");
    expect(policy.model).toBe("opt-out");
    expect(policy.legitimateInterestAllowed).toBe(true);
    expect(policy.obligations).toContain("tcpa_sms_consent");
  });
});

describe("IN policy", () => {
  it("formats INR in en-IN (lakh grouping)", () => {
    expect(formatCurrency(123456.78, "IN")).toBe("₹1,23,456.78");
  });
  it("validates PAN and IFSC", () => {
    expect(validateTaxId("pan", "ABCDE1234F", "IN")).toBe(true);
    expect(validateTaxId("pan", "ABC1234F", "IN")).toBe(false);
    expect(validateTaxId("ifsc", "HDFC0001234", "IN")).toBe(true);
    expect(validateTaxId("ifsc", "HDFC1234", "IN")).toBe(false);
  });
  it("validates PIN codes", () => {
    expect(validatePostalCode("560001", "IN")).toBe(true);
    expect(validatePostalCode("060001", "IN")).toBe(false);
  });
  it("is consent-only opt-in (DPDP)", () => {
    const policy = getConsentPolicy("IN");
    expect(policy.model).toBe("opt-in");
    expect(policy.lawfulBases).toEqual(["consent"]);
    expect(policy.legitimateInterestAllowed).toBe(false);
  });
  it("throws on an unknown tax-ID kind", () => {
    expect(() => validateTaxId("ein", "12-3456789", "IN")).toThrow(/Unknown tax-ID kind/);
  });
});
