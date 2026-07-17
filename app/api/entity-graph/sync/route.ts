import { NextResponse } from "next/server";
import { drainEntitySyncQueue } from "@/lib/entity-graph/sync";

// Manually-triggerable drain of the Postgres→Neo4j sync outbox. A
// Cloudflare Cron Trigger (../../../../worker.ts's scheduled() handler,
// wrangler.jsonc's triggers.crons — every minute) now drains this
// automatically in production; this route stays for manual exercising,
// testing, and forcing an immediate drain without waiting for the next
// cron tick.
//
// No auth gate yet, deliberately flagged: this is a dev-phase convenience
// route, same posture as homeai's /api/ai/smoke-test — protect or remove
// before anything resembling a public launch.
export async function POST() {
  try {
    const result = await drainEntitySyncQueue();
    return NextResponse.json({ status: "ok", ...result });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
