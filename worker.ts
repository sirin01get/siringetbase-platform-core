// Custom Worker entrypoint — OpenNext's generated .open-next/worker.js only
// exports a `fetch` handler, but Cloudflare Cron Triggers need a `scheduled`
// handler too. This is OpenNext's documented pattern for adding one:
// https://opennext.js.org/cloudflare/howtos/custom-worker
//
// wrangler.jsonc's `main` points here instead of directly at
// .open-next/worker.js — everything HTTP still goes through the generated
// Next.js handler unchanged; this file only adds the cron entry point on
// top of it.
//
// Excluded from tsc/`npm run typecheck` (see tsconfig.json's `exclude`):
// .open-next/worker.js doesn't exist until `opennextjs-cloudflare build`
// has run, which happens AFTER typecheck in both CI (.github/workflows/ci.yml)
// and Cloudflare's own build pipeline (`npm run cf:build`). Type-checking
// this file at the same time as the rest of the app would fail on a module
// that legitimately doesn't exist yet.
//
// @ts-nocheck

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import handler from "./.open-next/worker.js";
import { drainEntitySyncQueue } from "./src/lib/entity-graph/sync";
import { purgeDeletedAuditLogEntries } from "./src/lib/admin/audit-log-purge";
import { triggerCafocusSubscriptionBillingCycle } from "./src/lib/billing/subscription-billing-trigger";
import { triggerLawforgeDeadlineSweep } from "./src/lib/reminders/deadline-reminder-trigger";
import { sweepStuckExtractionJobs } from "./src/lib/document-intelligence/dead-letter-sweep";
import { processExtractionQueueBatch } from "./src/lib/document-intelligence/queue-consumer";

export default {
  fetch: handler.fetch,

  // Bulk document-extraction Queue consumer (document-extraction-queue,
  // wrangler.jsonc) — see queue-consumer.ts's header comment for how this
  // is what actually delivers "additional AI agents doing parallel
  // processing" for the bulk-upload feature: Cloudflare runs this handler
  // across multiple concurrent invocations per wrangler.jsonc's
  // max_concurrency, each pulling its own batch of messages, rather than
  // one Worker draining the whole queue sequentially. Same
  // env-population fix as scheduled() below is NOT needed here — Cloudflare
  // Queues consumers, unlike this file's custom scheduled() handler, DO go
  // through OpenNext's normal request-context setup, since a queue handler
  // is itself one of the entrypoints @opennextjs/cloudflare's generated
  // worker wires process.env for. (If a future env-related failure shows up
  // here, check that assumption first before re-adding the copy-loop.)
  async queue(batch, _env, ctx) {
    ctx.waitUntil(processExtractionQueueBatch(batch));
  },

  // Fires on either schedule configured in wrangler.jsonc's triggers.crons
  // — event.cron tells the two apart, since they run completely different
  // jobs on completely different cadences:
  //   "*/1 * * * *" — drains the Postgres -> Neo4j sync outbox (see
  //     siringetbase/entity-graph/data-sync-architecture.md §4, MVP item
  //     #1) — this is what turns sync from "only runs when a human
  //     remembers to POST /api/entity-graph/sync" into an actual
  //     dependable background job — AND, piggybacked on the same
  //     every-minute fire rather than a 4th distinct cron entry (Workers'
  //     free-plan cap is 3 Cron Triggers per Worker, and all 3 slots here
  //     were already spoken for), sweeps any document-intelligence
  //     extraction job stuck in 'processing' — see
  //     document-intelligence/dead-letter-sweep.ts's header comment for why
  //     this needs to run from a wholly separate invocation rather than
  //     rely on a timeout inside the original stuck request.
  //   "0 3 * * 0" — weekly purge of cafocus/app's admin_audit_log hidden
  //     bin (audit-log-purge.ts's header comment has the full "why here,
  //     not cafocus/app" reasoning).
  //   "0 5 * * *" — daily trigger for cafocus/app's recurring
  //     module-subscription billing cycle
  //     (subscription-billing-trigger.ts's header comment has the full
  //     "why an outbound call, not a direct query" reasoning — the reverse
  //     of the other two, which both act on data this Worker already owns).
  // ctx.waitUntil keeps the Worker alive until whichever job finishes,
  // since scheduled handlers are otherwise torn down as soon as this
  // function returns.
  async scheduled(event, _env, ctx) {
    // ROOT CAUSE FIX (2026-08-02): every single scheduled() invocation was
    // erroring out immediately, for at least 80+ minutes before this fix and
    // likely since this cron was first enabled — confirmed via Cloudflare's
    // Observability/Events log after finally enabling it: every invocation
    // logged "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL"
    // (src/config/env.ts's required() helper throwing) with sub-millisecond
    // CPU time, consistent with an immediate throw on the very first
    // Supabase client construction.
    //
    // Why: env.ts (and everything built on it — createSupabaseServiceRoleClient
    // in src/lib/supabase/server.ts, which every job below eventually calls)
    // reads plain `process.env.X`. OpenNext's generated .open-next/worker.js
    // only ever populates process.env from the real Cloudflare bindings
    // inside its own fetch() handler — see
    // node_modules/@opennextjs/cloudflare/dist/cli/templates/cloudflare/init.js's
    // populateProcessEnv(), called from runWithCloudflareRequestContext(),
    // which ONLY runs on the fetch() path. This custom scheduled() handler
    // bypasses that generated fetch() entirely (that's the whole point of
    // this file — see the header comment), so on an isolate that hasn't
    // handled an HTTP request first, process.env is simply empty here.
    // That's true of every prior "fix" attempt in this file too — sweepStuckExtractionJobs(),
    // drainEntitySyncQueue(), purgeDeletedAuditLogEntries(), and
    // triggerCafocusSubscriptionBillingCycle() were ALL silently failing on
    // every cron tick, not just the new dead-letter sweep.
    //
    // Fix: replicate populateProcessEnv()'s core behavior here — copy every
    // string-valued binding (vars + Worker Secrets) from the real `_env`
    // object Cloudflare passes into this handler onto process.env before
    // calling any job. Cheap and idempotent, safe to do on every invocation.
    for (const [key, value] of Object.entries(_env as Record<string, unknown>)) {
      if (typeof value === "string") {
        process.env[key] = value;
      }
    }

    // The diagnostic throw that used to sit here (2026-08-02) has been
    // removed while touching this file for the bulk-upload queue() handler
    // above — it was unconditionally throwing on EVERY scheduled()
    // invocation regardless of cron, which means every job below (audit-log
    // purge, subscription billing, entity-sync drain, dead-letter sweep)
    // has been silently failing on every tick since it was added, not just
    // during the original investigation. The env-population loop
    // immediately above IS the real, confirmed fix (populateProcessEnv()'s
    // own behavior, replicated for this handler) — this diagnostic was left
    // in past the point it had already done its job. Deploy this change and
    // check Cloudflare's Observability/Events log after the next few
    // ticks to confirm all four jobs now complete instead of throwing.

    if (event.cron === "0 3 * * 0") {
      ctx.waitUntil(purgeDeletedAuditLogEntries());
      return;
    }
    if (event.cron === "0 5 * * *") {
      // Two verticals' daily jobs share this one cron slot (2026-08-16).
      // Not a 4th cron entry, for the same free-plan reason the header
      // comment above already gives for folding the dead-letter sweep in
      // — and LawForge is here at all precisely because the account has no
      // Cron Trigger slots left for it to schedule itself. See
      // src/lib/reminders/deadline-reminder-trigger.ts.
      //
      // Promise.all, not sequential: they're unrelated jobs against
      // different Workers, so one being slow shouldn't delay the other.
      // Both triggers swallow their own errors (each logs and returns), so
      // Promise.all can't reject here and one failing can't cancel the
      // other.
      ctx.waitUntil(Promise.all([triggerCafocusSubscriptionBillingCycle(), triggerLawforgeDeadlineSweep()]));
      return;
    }
    ctx.waitUntil(Promise.all([drainEntitySyncQueue(), sweepStuckExtractionJobs()]));
  },
};
