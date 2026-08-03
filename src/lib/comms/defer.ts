// @ts-nocheck
//
// Isolated the same way as src/lib/security/rate-limit.ts and
// src/lib/document-intelligence/model-gateway.ts (see either file's header
// comment): @opennextjs/cloudflare's getCloudflareContext() ships types
// that collide with this project's "dom" lib, so this one small file eats
// the @ts-nocheck instead of the caller. Also listed in eslint.config.mjs's
// ignores for the same reason those two files are (ban-ts-comment has no
// allow-with-description override configured).
//
// Why this exists: app/api/comms/auth-email-hook/route.ts must respond to
// Supabase's Send Email Hook within its ~5s SLA
// (https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook —
// "Failed to reach hook within maximum time of 5.000000 seconds" is
// GoTrue's own error when it isn't). The route's only genuinely necessary
// synchronous work is verifying the webhook signature and calling Resend —
// the two notification_dispatch Postgres calls (src/lib/comms/log.ts's
// logDispatchAttempt/updateDispatchResult) are observability, not part of
// the contract with Supabase, and log.ts's own header comment already says
// as much ("Logging failure must never block the actual send"). They were
// still being `await`ed in the route's critical path, which is the actual
// bug this fixes.
//
// ctx.waitUntil() keeps the Worker alive to finish a promise after the
// response has already been sent — the standard Cloudflare Workers pattern
// for exactly this ("respond now, finish logging in the background"). Falls
// back to a fire-and-forget .catch() when no Workers ExecutionContext is
// available (e.g. local `next dev`, not running under the Cloudflare
// adapter) so this doesn't throw in dev.

import { getCloudflareContext } from "@opennextjs/cloudflare";

export function deferAfterResponse(work: Promise<unknown>): void {
  try {
    const { ctx } = getCloudflareContext();
    if (ctx?.waitUntil) {
      ctx.waitUntil(work.catch((err) => console.error("comms: deferred work failed", err)));
      return;
    }
  } catch (err) {
    console.error("comms: getCloudflareContext() unavailable for deferAfterResponse", err);
  }
  // No Workers context (local dev) — still run it, just don't block on it
  // and don't let a rejection become an unhandled promise rejection.
  void work.catch((err) => console.error("comms: deferred work failed", err));
}
