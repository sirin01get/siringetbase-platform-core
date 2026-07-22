import { createMockSms, createMockTelephony } from "../mock-helpers";

// Telnyx is the cheaper fallback the infra doc names
// (USVALUE/PMMUSA/01-infrastructure.md Gap 1: "the port makes the swap a
// config change"). Having a second mock from day 1 keeps the contract
// suite honest about provider-agnosticism — the suite runs against both.
export const telnyxMockSms = createMockSms("telnyx-mock");
export const telnyxMockTelephony = createMockTelephony("telnyx-mock");
