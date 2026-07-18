import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { verifySendEmailHookSignature, WebhookVerificationError } from "@/lib/comms/verify-webhook";
import { getEmailSender } from "@/lib/comms/provider-registry";
import { logDispatchAttempt, updateDispatchResult } from "@/lib/comms/log";
import { TemplateNotFoundError } from "@/lib/comms/templates/registry";
import type { SendEmailRequest } from "@/lib/comms/types";

// Supabase Auth's Send Email Hook — registered once, dashboard-side, at
// Authentication → Hooks → Send Email (https://supabase.com/dashboard/project/_/auth/hooks),
// pointed at this route's deployed URL. Supabase calls this endpoint
// instead of relaying its own rendered template to Resend over SMTP — see
// ../../../../../comms/README.md's "Two Entry Points" section for the full
// design. One shared hook endpoint for every vertical/role, since there's
// one Supabase project (../../../../../identity/README.md).
//
// Payload shape confirmed against Supabase's current docs
// (https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook):
// { user: {...}, email_data: { token, token_hash, redirect_to,
// email_action_type, site_url, token_new, token_hash_new, old_email,
// old_phone, provider, factor_type } }. No outputs required on success —
// an empty 200 response is all Supabase expects.

const TRIGGER_EVENT_MAP: Record<string, string> = {
  // CA Focus's sign-in form calls signInWithOtp() for both a brand-new
  // signer and a returning verified CA (CaSignInForm.tsx's header
  // comment) — Supabase may report either action type for the same link,
  // so both map to the same copy.
  magiclink: "auth.magic_link",
  signup: "auth.magic_link",
  recovery: "auth.recovery",
  invite: "auth.invite",
  email_change: "auth.email_change",
  reauthentication: "auth.reauthentication",
};

function inferVertical(originHost: string): string {
  if (originHost.includes("cafocus")) return "cafocus";
  if (originHost.includes("buildfocus")) return "buildfocus";
  return "unknown";
}

interface SendEmailHookPayload {
  user: {
    email: string;
    user_metadata?: Record<string, unknown>;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
  };
}

function errorResponse(httpCode: number, message: string) {
  return NextResponse.json({ error: { http_code: httpCode, message } }, { status: httpCode });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  try {
    await verifySendEmailHookSignature(
      rawBody,
      {
        "webhook-id": req.headers.get("webhook-id"),
        "webhook-timestamp": req.headers.get("webhook-timestamp"),
        "webhook-signature": req.headers.get("webhook-signature"),
      },
      env.sendEmailHookSecret()
    );
  } catch (err) {
    const message = err instanceof WebhookVerificationError ? err.message : "Signature verification failed";
    return errorResponse(401, message);
  }

  let payload: SendEmailHookPayload;
  try {
    payload = JSON.parse(rawBody) as SendEmailHookPayload;
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const { user, email_data } = payload;

  // Primary signal: redirect_to's origin (which vertical's app) and an
  // explicit ?role= query param the onboarding page appends (see
  // cafocus/app/app/onboarding/ca/CaSignInForm.tsx's redirectUrl
  // construction) — ../../../../../comms/README.md's "inferred, not
  // guessed from path patterns" rule.
  let vertical = "unknown";
  let role = "unknown";
  try {
    const redirectUrl = new URL(email_data.redirect_to);
    vertical = inferVertical(redirectUrl.hostname);
    role = redirectUrl.searchParams.get("role") ?? role;
  } catch {
    // Malformed redirect_to — fall through to the metadata secondary signal below.
  }

  // Secondary signal, per design: user_metadata set at signInWithOtp() time.
  if (role === "unknown" && typeof user.user_metadata?.intended_role === "string") {
    role = user.user_metadata.intended_role;
  }
  if (vertical === "unknown" && typeof user.user_metadata?.intended_vertical === "string") {
    vertical = user.user_metadata.intended_vertical;
  }

  const triggerEvent = TRIGGER_EVENT_MAP[email_data.email_action_type] ?? `auth.${email_data.email_action_type}`;

  const confirmationUrl = `${env.supabaseUrl()}/auth/v1/verify?${new URLSearchParams({
    token: email_data.token_hash,
    type: email_data.email_action_type,
    redirect_to: email_data.redirect_to,
  }).toString()}`;

  const sendRequest: SendEmailRequest = {
    to: user.email,
    vertical,
    role,
    triggerEvent,
    templateData: {
      confirmationUrl,
      token: email_data.token,
      email: user.email,
      siteUrl: email_data.site_url,
    },
  };

  const dispatchId = await logDispatchAttempt(sendRequest);

  try {
    const sender = getEmailSender();
    const result = await sender.send(sendRequest);
    await updateDispatchResult(dispatchId, result);

    if (!result.success) {
      return errorResponse(500, result.failureReason ?? "Email provider reported a failed send");
    }
  } catch (err) {
    const message =
      err instanceof TemplateNotFoundError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error sending email";
    await updateDispatchResult(dispatchId, {
      success: false,
      providerMessageId: "",
      status: "failed",
      failureReason: message,
      rawResponse: {},
    });
    return errorResponse(500, message);
  }

  // Empty 200 — everything Supabase requires for a successful hook response.
  return new NextResponse(null, { status: 200 });
}
