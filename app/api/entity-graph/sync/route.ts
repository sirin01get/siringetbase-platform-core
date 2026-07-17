import { NextResponse } from "next/server";
import { drainEntitySyncQueue } from "@/lib/entity-graph/sync";

// Manually-triggerable drain of the Postgres→Neo4j sync outbox. Meant to be
// wired to a Cloudflare Cron Trigger once deployed (e.g. every minute) —
// exposed as a POST route in the meantime so it can be exercised by hand or
// called from a scheduled task before real cron wiring exists.
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
