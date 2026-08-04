// The template registry — (vertical, role, triggerEvent) -> TemplateRenderer.
// Comms owns this registry's *mechanism*; each vertical owns the *entries*
// (../../../../comms/README.md's "The Boundary Rule"). New verticals add a
// file here (e.g. templates/buildfocus.ts) and one line below — they don't
// touch the hook route or send-notification.ts.

import type { RenderedEmail, TemplateKey } from "../types";
import { CA_TEMPLATES, CLIENT_TEMPLATES, PROSPECT_TEMPLATES } from "./ca";
import { FALLBACK_TEMPLATES } from "./fallback";
import { INTERNAL_TEMPLATES } from "./support";

// vertical -> role -> triggerEvent -> renderer
const REGISTRY: Record<string, Record<string, Record<string, (data: Record<string, unknown>) => RenderedEmail>>> = {
  cafocus: {
    ca: CA_TEMPLATES,
    // "individual" / "smb_owner" don't have a full onboarding-flow template
    // set (../../../../cafocus/README.md's phase plan) — CLIENT_TEMPLATES is
    // just the one dedicated entry ("referral.ca_client_invite", a CA
    // inviting an existing client onto the platform for a specific,
    // already-agreed engagement). Every other triggerEvent for these two
    // roles still falls through to FALLBACK_TEMPLATES below, on purpose —
    // e.g. the generic self-service/admin "referral.marketer_invite" invite
    // is deliberately NOT branded here, so it stays one shared template
    // across all the flows that reuse it (see ./ca.ts's
    // referralCaClientInvite() header comment for why it needed its own
    // triggerEvent instead of reusing that one).
    individual: CLIENT_TEMPLATES,
    smb_owner: CLIENT_TEMPLATES,

    // Not a real siringetbase.role_profiles.role value — a comms-only
    // addressing bucket for client-endorsement broadcast recipients, who
    // don't have any role yet (see ./ca.ts's referralClientEndorsement()
    // comment). Sent from app/api/referrals/endorse/route.ts with
    // role: "prospect".
    prospect: PROSPECT_TEMPLATES,
  },
};

export class TemplateNotFoundError extends Error {}

// Lookup order: platform-internal entry (./support.ts and any future
// non-vertical-branded triggerEvent) -> exact (vertical, role) entry ->
// vertical-agnostic fallback. Internal templates are checked first because
// their triggerEvent namespace (e.g. "support.*") is never something a
// vertical is expected to supply its own copy for — see
// ../../../../support-escalation/README.md's "Where This Lives" note on
// support.error_report_filed being internal/plain, not vertical-branded.
// Never falls through silently past a *found-but-missing-triggerEvent* case
// inside a real vertical/role entry — that's a real gap worth erroring on,
// distinct from "this role has no templates authored at all yet."
export function getTemplate(key: TemplateKey): (data: Record<string, unknown>) => RenderedEmail {
  const internal = INTERNAL_TEMPLATES[key.triggerEvent];
  if (internal) {
    return internal;
  }

  const roleTemplates = REGISTRY[key.vertical]?.[key.role];
  const exact = roleTemplates?.[key.triggerEvent];
  if (exact) {
    return exact;
  }

  const fallback = FALLBACK_TEMPLATES[key.triggerEvent];
  if (fallback) {
    return fallback;
  }

  throw new TemplateNotFoundError(
    `No template for vertical="${key.vertical}" role="${key.role}" triggerEvent="${key.triggerEvent}", and no fallback exists for that triggerEvent either.`
  );
}
