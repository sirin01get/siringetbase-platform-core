import { createMockSms, createMockTelephony } from "../mock-helpers";

// Stand-in for a real Twilio integration (Programmable Voice + SMS —
// USVALUE/PMMUSA/01-infrastructure.md Gap 1). Swapping this for
// `twilio.ts` later means: implement TelephonyPort/SmsPort against the
// real Twilio API, pass the same contract tests these mocks pass, flip
// TELEPHONY_PROVIDER / SMS_PROVIDER — no change to any caller.
export const twilioMockSms = createMockSms("twilio-mock");
export const twilioMockTelephony = createMockTelephony("twilio-mock");
