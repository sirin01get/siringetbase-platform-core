// Standard Webhooks (svix-compatible) HMAC verification for Supabase's Send
// Email Hook — see ../../../comms/README.md's "Where This Lives" guardrail:
// every hook request is signature-verified before its contents are trusted,
// full stop, no exceptions.
//
// Hand-rolled against the public Standard Webhooks spec
// (https://www.standardwebhooks.com/) rather than the `standardwebhooks` npm
// package Supabase's own docs example uses, for one reason: this route runs
// on Cloudflare Workers (via OpenNext, see ../../../worker.ts), and Web
// Crypto (`crypto.subtle`) is natively available there with zero extra
// dependency — no need to pull in a package to do what's fundamentally one
// HMAC-SHA256 call. If Supabase's hook payload format or signing scheme ever
// changes, cross-check against their current docs
// (https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook) before
// assuming this still matches.
//
// Algorithm (Standard Webhooks v1):
//   1. secret arrives as "v1,whsec_<base64>" (the exact string Supabase's
//      dashboard shows at hook-registration time) — strip the "v1,whsec_"
//      prefix, base64-decode the rest to get the raw HMAC key bytes.
//   2. signed_content = `${webhook-id header}.${webhook-timestamp header}.${raw body}`
//   3. expected signature = base64(HMAC-SHA256(key, signed_content))
//   4. webhook-signature header holds one or more space-separated
//      "v1,<base64sig>" entries — a match against ANY of them is valid
//      (supports secret rotation on Supabase's side without a hard cutover).
//   5. Reject if webhook-timestamp is outside a tolerance window — bounds
//      replay of a captured request.

const TOLERANCE_SECONDS = 5 * 60;

export class WebhookVerificationError extends Error {}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i] ?? 0);
  return btoa(binary);
}

// Constant-time-ish comparison — not perfectly timing-safe (Workers'
// Web Crypto doesn't expose a built-in constant-time byte compare), but
// meaningfully better than `===` on strings of attacker-visible length,
// and consistent with what a from-scratch Workers implementation can do
// without an extra dependency.
// Exported for reuse by ../../../app/api/comms/notify/route.ts's simpler
// shared-secret header check — same "meaningfully better than `===`"
// reasoning applies there too, no need for a second copy.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export interface WebhookHeaders {
  "webhook-id": string | null;
  "webhook-timestamp": string | null;
  "webhook-signature": string | null;
}

// Verifies the raw request body against Supabase's Send Email Hook
// signature. Throws WebhookVerificationError on any failure — callers must
// not proceed to render/send on a caught error, only 401.
export async function verifySendEmailHookSignature(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string
): Promise<void> {
  const webhookId = headers["webhook-id"];
  const webhookTimestamp = headers["webhook-timestamp"];
  const webhookSignature = headers["webhook-signature"];

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    throw new WebhookVerificationError("Missing webhook-id / webhook-timestamp / webhook-signature header");
  }

  const timestampSeconds = Number(webhookTimestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw new WebhookVerificationError("webhook-timestamp header is not a valid unix timestamp");
  }
  const nowSeconds = Date.now() / 1000;
  if (Math.abs(nowSeconds - timestampSeconds) > TOLERANCE_SECONDS) {
    throw new WebhookVerificationError("webhook-timestamp is outside the acceptable tolerance window");
  }

  const secretWithoutPrefix = secret.replace(/^v1,whsec_/, "").replace(/^whsec_/, "");
  const keyBytes = base64ToBytes(secretWithoutPrefix);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(signedContent));
  const expectedSignature = bytesToBase64(signatureBuffer);

  // webhook-signature can carry multiple "v1,<sig>" entries space-separated.
  const providedSignatures = webhookSignature
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^v1,/, ""));

  const matched = providedSignatures.some((sig) => timingSafeEqual(sig, expectedSignature));
  if (!matched) {
    throw new WebhookVerificationError("Signature mismatch");
  }
}
