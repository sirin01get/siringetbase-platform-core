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

export default {
  fetch: handler.fetch,

  // Fires on either schedule configured in wrangler.jsonc's triggers.crons
  // — event.cron tells the two apart, since they run completely different
  // jobs on completely different cadences:
  //   "*/1 * * * *" — drains the Postgres -> Neo4j sync outbox (see
  //     siringetbase/entity-graph/data-sync-architecture.md §4, MVP item
  //     #1) — this is what turns sync from "only runs when a human
  //     remembers to POST /api/entity-graph/sync" into an actual
  //     dependable background job.
  //   "0 3 * * 0" — weekly purge of cafocus/app's admin_audit_log hidden
  //     bin (audit-log-purge.ts's header comment has the full "why here,
  //     not cafocus/app" reasoning).
  // ctx.waitUntil keeps the Worker alive until whichever job finishes,
  // since scheduled handlers are otherwise torn down as soon as this
  // function returns.
  async scheduled(event, _env, ctx) {
    if (event.cron === "0 3 * * 0") {
      ctx.waitUntil(purgeDeletedAuditLogEntries());
      return;
    }
    ctx.waitUntil(drainEntitySyncQueue());
  },
};
