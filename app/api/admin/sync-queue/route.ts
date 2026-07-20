import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/auth";

// Lists entity_sync_queue rows that need a human's attention: 'dead_letter'
// (exhausted all automatic retries — see src/lib/entity-graph/sync.ts's
// MAX_ATTEMPTS), the legacy 'failed' status (pre-0002_sync_retry_hardening.sql
// rows, kept in the status check constraint for backward compatibility but
// no longer written by current code), and 'pending' rows currently backing
// off (next_attempt_at in the future) — informational, since those will
// retry automatically, but still useful to see rather than dig for in SQL.
//
// This is a narrow, single-purpose view living in platform-core because
// that's what owns entity_sync_queue — NOT the full cross-vertical
// operator console described in ../../admin/README.md (dispute review,
// ServiceProvider verification, fraud review), which is a separate, much
// larger future build. This page only does one thing: surface unsynced
// rows and let someone push them.
//
// support_admin only — real per-admin session + audit trail via
// requireAdmin() (see ../../../../README.md "Access control"). Read-only,
// so this GET isn't itself logged as an action beyond requireAdmin()'s own
// denial logging — the mutating retry route below is where an audit entry
// actually matters.
export async function GET(request: Request) {
  const auth = await requireAdmin(request, "sync_queue.list", ["support_admin"]);
  if (!auth.ok) return auth.response;

  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase
    .from("entity_sync_queue")
    .select("id, entity_type, vertical, operation, payload, status, attempts, error, created_at, next_attempt_at")
    .in("status", ["dead_letter", "failed", "pending"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ status: "error", message: error.message }, { status: 500 });
  }

  // 'pending' rows that are already actionable now (next_attempt_at has
  // elapsed) are what the Cron Trigger is about to pick up on its own —
  // not "stuck", just mid-flight. Only surface pending rows that are still
  // backing off, so this view stays focused on things worth a human's
  // attention rather than the entire normal-operation queue.
  const now = Date.now();
  const rows = (data ?? []).filter(
    (row) => row.status !== "pending" || new Date(row.next_attempt_at).getTime() > now
  );

  return NextResponse.json({ status: "ok", rows });
}
