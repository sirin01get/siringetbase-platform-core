import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { drainEntitySyncQueue } from "@/lib/entity-graph/sync";
import { requireAdmin } from "@/lib/admin/auth";
import { writeAuditLog } from "@/lib/admin/audit";

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
// support_admin only — real per-admin session + audit trail via
// requireAdmin() (see ../../../../README.md "Access control"). This
// mutates data (unlike the read-only GET above it), so its audit entry
// carries the exact row ids retried and the drain result.
export async function POST(request: Request) {
  const auth = await requireAdmin(request, "sync_queue.retry", ["support_admin"]);
  if (!auth.ok) return auth.response;

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
    await writeAuditLog({
      actor: auth.actor,
      action: "sync_queue.retry",
      outcome: "error",
      detail: { ids: body.ids, error: resetError.message },
      request,
    });
    return NextResponse.json({ status: "error", message: resetError.message }, { status: 500 });
  }

  // Drain immediately rather than waiting for the next cron tick — this is
  // an admin explicitly asking for these rows to be pushed now.
  const drainResult = await drainEntitySyncQueue();

  await writeAuditLog({
    actor: auth.actor,
    action: "sync_queue.retry",
    targetType: "entity_sync_queue",
    outcome: "success",
    detail: { ids: body.ids, requeued: body.ids.length, drainResult },
    request,
  });

  return NextResponse.json({ status: "ok", requeued: body.ids.length, drainResult });
}
