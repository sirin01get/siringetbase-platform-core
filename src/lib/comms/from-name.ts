// Per-vertical From: display name — comms owns the pipeline, the vertical
// owns the copy (see ./templates/registry.ts's header comment on "The
// Boundary Rule"), and the sender name on the envelope is part of that
// copy just as much as the template subject/body is, even though the
// underlying address (src/config/env.ts's commsFromAddress()) stays one
// shared, Resend-verified domain across every vertical.
//
// Bug fix (2026-08-09): the From: name used to be a single hardcoded
// literal — "CA Focus <onboarding@email.siringet.com>" — used for every
// vertical's send regardless of which vertical's template actually
// rendered the body, since getEmailSender() in provider-registry.ts is a
// process-wide singleton. This map plus ResendAdapter.send() resolving it
// per-request (using SendEmailRequest.vertical) is the real fix, not just
// a neutral placeholder name.
//
// New vertical checklist: add its line here alongside its
// templates/<vertical>.ts entry and its inferVertical() branch in the Send
// Email Hook route — three one-line additions, no shared code touched.
const VERTICAL_FROM_NAMES: Record<string, string> = {
  cafocus: "CA Focus",
  lawforge: "LawForge",
};

// Falls back to the neutral "Siringet" identity for anything without an
// entry above — internal support.*-style sends (never vertical-branded,
// see ./templates/support.ts) and any future vertical before someone adds
// its name here.
export function resolveFromName(vertical: string): string {
  return VERTICAL_FROM_NAMES[vertical] ?? "Siringet";
}
