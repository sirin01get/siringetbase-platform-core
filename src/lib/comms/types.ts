// EmailSenderPort — the interface every comms send goes through, never a
// concrete vendor directly. Same discipline as ../payments/types.ts's
// PaymentGatewayPort/BankPayoutPort: calling code (the hook route,
// sendNotification()) depends on this interface only, so swapping Resend
// for a future CloudflareEmailAdapter is a registry/config change, not a
// rewrite. Design: ../../comms/README.md's "Provider Abstraction" section.

export interface SendEmailRequest {
  to: string;
  vertical: string;
  role: string;
  // e.g. "auth.magic_link", "verification.approved" — resolves to a
  // template component via the registry (./templates/registry.ts) before
  // ever reaching an adapter's send().
  triggerEvent: string;
  templateData: Record<string, unknown>;
}

export interface SendEmailResult {
  success: boolean;
  providerMessageId: string;
  status: "sent" | "failed";
  failureReason?: string;
  rawResponse: Record<string, unknown>;
}

export interface EmailSenderPort {
  readonly providerName: string;
  send(request: SendEmailRequest): Promise<SendEmailResult>;
}

// A resolved template — subject + rendered HTML/text, produced by a
// registry entry from (vertical, role, triggerEvent) + templateData.
// Kept separate from SendEmailRequest so the registry lookup/render step
// is independently testable from the provider call.
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type TemplateRenderer = (data: Record<string, unknown>) => RenderedEmail;

// Registry key shape — (vertical, role, triggerEvent). Vertical-supplied
// entries, generic registry — see comms/README.md's "The Boundary Rule".
export interface TemplateKey {
  vertical: string;
  role: string;
  triggerEvent: string;
}
