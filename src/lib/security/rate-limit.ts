// @ts-nocheck
//
// Enterprise-gap fix: no real rate limiting existed anywhere in this repo
// before this file. Unlike cafocus/app (see its own identical file's
// header comment for the fuller reasoning — this is the same design,
// mirrored per-repo since these are separate Cloudflare deployments with
// no shared runtime), this Worker's own routes are mostly either
// secret-header-gated service-to-service endpoints (document-intelligence/
// extract, comms/notify) or Supabase's own webhook callback
// (comms/auth-email-hook) — not directly browser-facing. A valid secret or
// a real Supabase-signed webhook already means "this is a trusted caller,"
// so what this guards against isn't an anonymous attacker so much as a bug
// or compromised caller looping unboundedly against a real cost (Workers
// AI vision-model calls, Resend email sends) — still worth capping even
// though the threat model differs from a public form.
//
// Cloudflare's native Rate Limiting binding — see wrangler.jsonc's
// "ratelimits" block and https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/.
// @ts-nocheck for the same getCloudflareContext()-types-collide-with-"dom"
// reason as src/lib/document-intelligence/model-gateway.ts.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

// Must match the "name" fields under wrangler.jsonc's "ratelimits" array.
export type RateLimitBucket = "RL_EXTRACT" | "RL_NOTIFY" | "RL_AUTH_EMAIL";

export async function isRateLimited(bucket: RateLimitBucket, key: string): Promise<boolean> {
  const { env } = getCloudflareContext();
  const limiter = env[bucket];
  if (!limiter) {
    // No binding — local dev, or a deploy still catching up. Fail open,
    // same posture as cafocus/app's identical helper.
    return false;
  }
  const { success } = await limiter.limit({ key });
  return !success;
}

export async function rateLimitOrNull(bucket: RateLimitBucket, key: string): Promise<NextResponse | null> {
  if (await isRateLimited(bucket, key)) {
    return NextResponse.json(
      { error: { http_code: 429, message: "Too many requests — please slow down and try again in a minute." } },
      { status: 429 }
    );
  }
  return null;
}
