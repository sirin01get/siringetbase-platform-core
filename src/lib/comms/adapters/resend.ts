// ResendAdapter — the first (and, today, only) EmailSenderPort
// implementation. Plain fetch() against Resend's HTTP API, not their SDK:
// same reasoning as ../../neo4j/client.ts's Query-API-over-fetch choice —
// this route runs on Cloudflare Workers, and a raw fetch() call has zero
// dependency surface / cold-start cost compared to pulling in an SDK for
// what's a single POST. See ../../../../comms/README.md's "Future
// Architecture" section for why Resend, not Cloudflare Email Service, is
// the adapter shipping first (Cloudflare Email Service is public beta,
// gated behind Workers Paid for arbitrary recipients).

import type { EmailSenderPort, SendEmailRequest, SendEmailResult } from "../types";
import { getTemplate } from "../templates/registry";

const RESEND_API_URL = "https://api.resend.com/emails";

export interface ResendAdapterConfig {
  apiKey: string;
  fromAddress: string; // e.g. "CA Focus <onboarding@cafocus.example>" — must be a Resend-verified sending domain
}

export function createResendAdapter(config: ResendAdapterConfig): EmailSenderPort {
  return {
    providerName: "resend",
    async send(request: SendEmailRequest): Promise<SendEmailResult> {
      const render = getTemplate({
        vertical: request.vertical,
        role: request.role,
        triggerEvent: request.triggerEvent,
      });
      const rendered = render(request.templateData);

      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.fromAddress,
          to: [request.to],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        }),
      });

      const rawResponse = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        return {
          success: false,
          providerMessageId: "",
          status: "failed",
          failureReason:
            typeof rawResponse.message === "string" ? rawResponse.message : `Resend responded ${response.status}`,
          rawResponse,
        };
      }

      return {
        success: true,
        providerMessageId: typeof rawResponse.id === "string" ? rawResponse.id : "",
        status: "sent",
        rawResponse,
      };
    },
  };
}
