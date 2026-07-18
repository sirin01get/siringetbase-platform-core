import { env } from "@/config/env";
import type { EmailSenderPort } from "./types";
import { createResendAdapter } from "./adapters/resend";

// The ONLY place calling code should ever look up which email provider is
// active — same pattern as ../payments/registry.ts's
// getPaymentGateway()/getBankPayout(). Today there's exactly one adapter
// (Resend); this still exists as a registry, not a direct import, so
// adding a CloudflareEmailAdapter later (../../../../comms/README.md's
// "Future Architecture") is a one-line addition here, not a rewrite of the
// hook route or send-notification.ts.
let cached: EmailSenderPort | null = null;

export function getEmailSender(): EmailSenderPort {
  if (cached) return cached;
  cached = createResendAdapter({
    apiKey: env.resendApiKey(),
    fromAddress: env.commsFromEmail(),
  });
  return cached;
}
