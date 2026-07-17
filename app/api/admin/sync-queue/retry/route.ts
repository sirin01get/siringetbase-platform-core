import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { drainEntitySyncQueue } from "@/lib/entity-graph/sync";

interface RetryRequestBody {
  ids: string[];
}

// Resets the given entity_sync_queue rows back to a fresh 'pending' state
// (attempts=0, next_attempt_at=now, error cleared) and immediately drains
// the queue once, so an admin gets to see the result right away instead of
// waiting for the next Cron Trigger tick. Selected rows can be any status —
// 'dead_letter' (exhausted retries), legacy 'failed', or a 'pending' row
// still backing off that someone wants pushed now rather than waiting.
//
// No auth gate yet — see app/api/admin/sync-queue/route.ts's header comment
// for the same caveat. This mutates data (unlike the read-only GET), so
// this is the one to prioritize gating before anything public.
export async function POST(request: Request) {
  let body: RetryRequestBody;
  try {
    body = (await request.json()) as RetryRequestBody;
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ status: "error", message: "Body must include a non-empty `ids` array." }, { status: 400 });
  }

  const supabase = createSupabaseServiceRoleClient();

  const { error: resetError } = await supabase
    .from("entity_sync_queue")
    .update({
      status: "pending",
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      error: null,
      processed_at: null,
    })
    .in("id", body.ids);

  if (resetError) {
    return NextResponse.json({ status: "error", message: resetError.message }, { status: 500 });
  }

  // Drain immediately rather than waiting for the next cron tick — this is
  // an admin explicitly asking for these rows to be pushed now.
  const drainResult = await drainEntitySyncQueue();

  return NextResponse.json({ status: "ok", requeued: body.ids.length, drainResult });
}
