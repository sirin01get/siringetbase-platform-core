import { env } from "@/config/env";
import type { SmsPort, TelephonyPort } from "./types";
import { twilioMockSms, twilioMockTelephony } from "./adapters/twilio-mock";
import { telnyxMockSms, telnyxMockTelephony } from "./adapters/telnyx-mock";
import { createTwilioSms, createTwilioTelephony, type TwilioConfig } from "./adapters/twilio";

// The ONLY place calling code should ever look up which telephony/SMS
// provider is active — same pattern as ../../payments/registry.ts and
// ../provider-registry.ts. Callers depend on TelephonyPort/SmsPort, never
// on a provider name; swapping Twilio for Telnyx (or mock for real) is a
// one-line env change here.

const SMS_PROVIDERS: Record<string, SmsPort> = {
  "twilio-mock": twilioMockSms,
  "telnyx-mock": telnyxMockSms,
};

const TELEPHONY_PROVIDERS: Record<string, TelephonyPort> = {
  "twilio-mock": twilioMockTelephony,
  "telnyx-mock": telnyxMockTelephony,
};

// Real Twilio adapters are built lazily from env — only when selected —
// so tests and mock-configured environments never require Twilio secrets.
let twilioCache: { sms: SmsPort; telephony: TelephonyPort } | null = null;
function twilioReal(): { sms: SmsPort; telephony: TelephonyPort } {
  if (twilioCache) return twilioCache;
  const config: TwilioConfig = {
    accountSid: env.twilioAccountSid(),
    apiKeySid: env.twilioApiKeySid(),
    apiKeySecret: env.twilioApiKeySecret(),
    fromNumber: env.twilioVoiceNumber(),
    messagingServiceSid: env.twilioMessagingServiceSid(),
  };
  twilioCache = { sms: createTwilioSms(config), telephony: createTwilioTelephony(config) };
  return twilioCache;
}

export function getSms(): SmsPort {
  const provider = env.smsProvider();
  if (provider === "twilio") return twilioReal().sms;
  const sms = SMS_PROVIDERS[provider];
  if (!sms) throw new Error(`Unknown SMS_PROVIDER: ${provider}`);
  return sms;
}

export function getTelephony(): TelephonyPort {
  const provider = env.telephonyProvider();
  if (provider === "twilio") return twilioReal().telephony;
  const telephony = TELEPHONY_PROVIDERS[provider];
  if (!telephony) throw new Error(`Unknown TELEPHONY_PROVIDER: ${provider}`);
  return telephony;
}

// Exposed for the contract suite: every registered adapter — mock and,
// later, real — must pass the same tests (__tests__/contract.test.ts).
export const allSmsAdapters = (): SmsPort[] => Object.values(SMS_PROVIDERS);
export const allTelephonyAdapters = (): TelephonyPort[] => Object.values(TELEPHONY_PROVIDERS);
