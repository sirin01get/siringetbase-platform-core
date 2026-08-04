import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { sendNotification } from "@/lib/comms/send-notification";
import { TemplateNotFoundError } from "@/lib/comms/templates/registry";
import type { SendEmailRequest } from "@/lib/comms/types";
import { rateLimitOrNull } from "@/lib/security/rate-limit";

// POST /api/comms/notify — the HTTP-callable wrapper around
// sendNotification() for callers running in a *different* deployed Worker
// (a vertical's own app, e.g. cafocus/app) that can't import that function
// directly. See ../../../../../comms/README.md's "Two Entry Points, One
// Pipeline" (path 2) and ../../../../../support-escalation/README.md's
// "Two Entry Points, Converging Like Comms Does" — this is the first real
// cross-Worker caller, for the support-report notification.
//
// Secret-header-protected, not signature-verified like the Send Email
// Hook: there's no third-party signer here, just a single trusted caller
// per vertical, so a shared-secret header (COMMS_INTERNAL_SECRET) is
// enough — same reasoning any internal service-to-service call on this
// platform uses. Never exposed to a browser; set as a Worker Secret on
// both platform-core and every calling vertical.

interface NotifyRequestBody {
  to?: string;
  vertical: string;
  role: string;
  triggerEvent: string;
  templateData: Record<string, unknown>;
  // Optional — see ../../../src/lib/comms/types.ts's SendEmailRequest.replyTo
  // header comment. Passed straight through to the adapter; this route does
  // no validation on it beyond what SendEmailRequest itself expects (a
  // plain email string), same trust level as `to` for a secret-header-
  // protected internal caller.
  replyTo?: string;
}

function errorResponse(httpCode: number, message: string) {
  return NextResponse.json({ error: { http_code: httpCode, message } }, { status: httpCode });
}

export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-comms-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.commsInternalSecret())) {
    return errorResponse(401, "Missing or invalid x-comms-internal-secret header");
  }

  let body: NotifyRequestBody;
  try {
    body = (await req.json()) as NotifyRequestBody;
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  if (!body.vertical || !body.role || !body.triggerEvent) {
    return errorResponse(400, "vertical, role, and triggerEvent are all required");
  }

  // Internal (support.*-style) triggerEvents resolve their own recipient
  // here rather than trusting whatever `to` the caller sent — see
  // src/config/env.ts's supportInboxEmail() comment: a vertical's backend
  // should never be able to redirect a support notification to an
  // arbitrary address. Anything else requires an explicit `to`.
  const to = body.triggerEvent.startsWith("support.") ? env.supportInboxEmail() : body.to;
  if (!to) {
    return errorResponse(400, "`to` is required for non-internal triggerEvents");
  }

  // Enterprise-gap fix: keyed on the recipient, not the caller — the
  // secret header above already establishes "this is a trusted vertical
  // backend," so what this guards against is a bug or loop in a calling
  // vertical repeatedly emailing the SAME address, not a generic abuser.
  const rateLimited = await rateLimitOrNull("RL_NOTIFY", `notify:${to}`);
  if (rateLimited) return rateLimited;

  const sendRequest: SendEmailRequest = {
    to,
    vertical: body.vertical,
    role: body.role,
    triggerEvent: body.triggerEvent,
    templateData: body.templateData ?? {},
    ...(body.replyTo ? { replyTo: body.replyTo } : {}),
  };

  try {
    const result = await sendNotification(sendRequest);
    if (!result.success) {
      return errorResponse(502, result.failureReason ?? "Email provider reported a failed send");
    }
    return NextResponse.json({ success: true, providerMessageId: result.providerMessageId });
  } catch (err) {
    const message =
      err instanceof TemplateNotFoundError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error sending notification";
    return errorResponse(500, message);
  }
}
