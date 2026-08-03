import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { verifySendEmailHookSignature, WebhookVerificationError } from "@/lib/comms/verify-webhook";
import { getEmailSender } from "@/lib/comms/provider-registry";
import { logDispatchAttempt, updateDispatchResult } from "@/lib/comms/log";
import { deferAfterResponse } from "@/lib/comms/defer";
import { TemplateNotFoundError } from "@/lib/comms/templates/registry";
import type { SendEmailRequest, SendEmailResult } from "@/lib/comms/types";
import { rateLimitOrNull } from "@/lib/security/rate-limit";

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

  // Enterprise-gap fix: this hook is the actual delivery point for every
  // magic-link/recovery/invite email GoTrue sends (see this file's header
  // comment) — the real "auth email" abuse surface the gap analysis meant,
  // even though the initial signInWithOtp() call itself goes straight from
  // the browser to Supabase, not through this app. GoTrue has its own
  // throttling before it ever calls this hook, but capping here too is
  // cheap defense-in-depth on this app's own Resend sending capacity/cost,
  // keyed per-recipient so it can't be used to spam one inbox.
  const rateLimited = await rateLimitOrNull("RL_AUTH_EMAIL", `auth-email:${user.email}`);
  if (rateLimited) return rateLimited;

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

  // notification_dispatch logging (logDispatchAttempt/updateDispatchResult)
  // is deliberately NOT awaited on this critical path — see defer.ts's
  // header comment. Supabase's Send Email Hook has a strict ~5s SLA
  // ("Failed to reach hook within maximum time of 5.000000 seconds" is
  // GoTrue's own error when a hook misses it); the two Postgres round-trips
  // this logging needs were previously sequential/awaited alongside the
  // Resend call itself, which was long enough to blow that budget on a cold
  // Worker start. The insert->update pairing still has to happen in order
  // (the update needs the row id the insert returns), so both are chained
  // into a single promise and handed to deferAfterResponse() together —
  // only the Resend send itself remains in the awaited critical path.
  let result: SendEmailResult;
  try {
    const sender = getEmailSender();
    result = await sender.send(sendRequest);
  } catch (err) {
    const message =
      err instanceof TemplateNotFoundError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error sending email";
    deferAfterResponse(
      logDispatchAttempt(sendRequest).then((dispatchId) =>
        updateDispatchResult(dispatchId, {
          success: false,
          providerMessageId: "",
          status: "failed",
          failureReason: message,
          rawResponse: {},
        })
      )
    );
    return errorResponse(500, message);
  }

  deferAfterResponse(
    logDispatchAttempt(sendRequest).then((dispatchId) => updateDispatchResult(dispatchId, result))
  );

  if (!result.success) {
    return errorResponse(500, result.failureReason ?? "Email provider reported a failed send");
  }

  // A bare `NextResponse(null, ...)` sends no Content-Type header at all —
  // GoTrue's hook-response handling rejects that with "Invalid Content-Type:
  // Missing Content-Type header" even though the body itself is optional on
  // success. NextResponse.json() sets Content-Type: application/json for us,
  // which is what GoTrue actually requires here (confirmed empirically —
  // this is not documented explicitly in Supabase's Send Email Hook docs).
  return NextResponse.json({}, { status: 200 });
}
