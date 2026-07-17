import { runCypher } from "@/lib/neo4j/client";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Roles that make an entity a `:ServiceProvider` in the entity graph — and,
// per ../../billing/README.md, opt it into revenue-share billing. Extend
// this set when a vertical adds a new earner role; nothing else needs to
// change for that role to be correctly graphed and billed. Everything NOT
// in this set (individual, homebuyer, smb_owner, admin, ...) stays a plain
// :Person or :Business — a payer, never an earner.
const SERVICE_PROVIDER_ROLES = new Set(["ca", "builder", "architect"]);

// Retry-with-backoff tuning — MVP item #2 in
// ../../entity-graph/data-sync-architecture.md §4. A failed row gets
// MAX_ATTEMPTS tries (with exponential backoff between them, capped at
// MAX_BACKOFF_MINUTES) before it's left in a terminal 'dead_letter' status
// instead of being retried forever.
const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MINUTES = 30;

type LabelGroup = "Person" | "Person:ServiceProvider" | "Business" | "Business:ServiceProvider";

interface SyncQueueItem {
  id: string;
  operation: "upsert" | "delete";
  attempts: number;
  payload: {
    role_profile_id: string;
    user_id: string | null;
    business_id: string | null;
    vertical: string;
    role: string;
    status: string;
  };
}

interface DrainResult {
  processed: number;
  retryScheduled: number;
  deadLettered: number;
}

// Drains up to `batchSize` actionable entity_sync_queue rows (status =
// 'pending' AND next_attempt_at has elapsed — see 0001_init.sql's
// enqueue_entity_sync trigger and 0002_sync_retry_hardening.sql's retry
// columns), upserting the corresponding node in Neo4j for each. Postgres
// stays the source of truth throughout — this function only ever reads from
// Postgres and writes to Neo4j, never the reverse
// (../../entity-graph/README.md's sync contract).
//
// Runs on a Cloudflare Cron Trigger (see ../../worker.ts, wrangler.jsonc's
// triggers.crons) every minute in production; also exposed via
// app/api/entity-graph/sync/route.ts for manual invocation/testing.
export async function drainEntitySyncQueue(batchSize = 50): Promise<DrainResult> {
  const supabase = createSupabaseServiceRoleClient();

  const { data: items, error } = await supabase
    .from("entity_sync_queue")
    .select("id, operation, attempts, payload")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (error) throw new Error(`Failed to read entity_sync_queue: ${error.message}`);
  if (!items || items.length === 0) return { processed: 0, retryScheduled: 0, deadLettered: 0 };

  const queueItems = items as SyncQueueItem[];

  // 'delete' intentionally unimplemented in Phase 0 — no vertical
  // soft-deletes a role_profile yet. Filter these out up front (rather than
  // silently succeeding a no-op) so they're visible in diagnostics if one
  // ever does show up unexpectedly, instead of quietly marked "processed".
  const upserts = queueItems.filter((item) => item.operation === "upsert");

  // Batch by label combination (MVP item #3) — only four possible groups —
  // and send one UNWIND MERGE per group instead of one HTTP request per
  // row. Cuts up to `batchSize` round-trips to the Neo4j Query API down to
  // at most 4 in the common (no-error) case.
  const groups = new Map<LabelGroup, SyncQueueItem[]>();
  for (const item of upserts) {
    const labels = labelGroupFor(item);
    const group = groups.get(labels);
    if (group) {
      group.push(item);
    } else {
      groups.set(labels, [item]);
    }
  }

  let processed = 0;
  let retryScheduled = 0;
  let deadLettered = 0;

  for (const [labels, groupItems] of groups) {
    try {
      // Happy path: one batched statement for the whole group.
      await upsertNodesBatch(labels, groupItems);
      for (const item of groupItems) {
        await markProcessed(supabase, item.id);
        processed += 1;
      }
    } catch {
      // The batched statement failed — Neo4j's Query API aborts the whole
      // UNWIND on any statement-level error, so we can't tell which row(s)
      // in the group were the problem from that error alone. Fall back to
      // processing this group one row at a time, preserving the original
      // per-row fault isolation guarantee (one bad row can't take the rest
      // of the group down with it) at the cost of losing the batching win
      // just for this group, just this drain.
      for (const item of groupItems) {
        try {
          await upsertNode(item);
          await markProcessed(supabase, item.id);
          processed += 1;
        } catch (rowErr) {
          const outcome = await markFailed(supabase, item, rowErr);
          if (outcome === "dead_letter") deadLettered += 1;
          else retryScheduled += 1;
        }
      }
    }
  }

  return { processed, retryScheduled, deadLettered };
}

// Backlog visibility (MVP item #4) — read by app/api/diagnostics/route.ts.
// Deliberately cheap (count-only queries against the partial indexes
// 0002_sync_retry_hardening.sql adds) so calling this on every diagnostics
// hit doesn't itself become a performance problem.
export interface QueueStats {
  pendingCount: number;
  oldestPendingAgeSeconds: number | null;
  deadLetterCount: number;
}

export async function getEntitySyncQueueStats(): Promise<QueueStats> {
  const supabase = createSupabaseServiceRoleClient();

  const [{ count: pendingCount }, { data: oldestPending }, { count: deadLetterCount }] = await Promise.all([
    supabase.from("entity_sync_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("entity_sync_queue")
      .select("created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1),
    supabase.from("entity_sync_queue").select("id", { count: "exact", head: true }).eq("status", "dead_letter"),
  ]);

  const oldest = oldestPending?.[0]?.created_at;
  const oldestPendingAgeSeconds = oldest
    ? Math.round((Date.now() - new Date(oldest).getTime()) / 1000)
    : null;

  return {
    pendingCount: pendingCount ?? 0,
    oldestPendingAgeSeconds,
    deadLetterCount: deadLetterCount ?? 0,
  };
}

function labelGroupFor(item: SyncQueueItem): LabelGroup {
  const isServiceProvider = SERVICE_PROVIDER_ROLES.has(item.payload.role);
  const base = item.payload.user_id ? "Person" : "Business";
  return (isServiceProvider ? `${base}:ServiceProvider` : base) as LabelGroup;
}

// Batched happy-path write: one UNWIND MERGE for every row sharing the same
// label combination. Neo4j labels can't be query parameters — the `labels`
// interpolation here is safe because it only ever comes from labelGroupFor's
// fixed, code-controlled set of four strings, never from raw user input.
async function upsertNodesBatch(labels: LabelGroup, items: SyncQueueItem[]): Promise<void> {
  const rows = items.map((item) => ({
    roleProfileId: item.payload.role_profile_id,
    vertical: item.payload.vertical,
    role: item.payload.role,
    status: item.payload.status,
  }));

  await runCypher(
    `UNWIND $rows AS row
     MERGE (n:${labels} {role_profile_id: row.roleProfileId})
     SET n.vertical = row.vertical,
         n.role = row.role,
         n.status = row.status,
         n.updated_at = datetime()`,
    { rows }
  );
}

// Single-row fallback — same MERGE as the batched version, used only when a
// group's batched statement fails, to isolate which specific row(s) are bad.
async function upsertNode(item: SyncQueueItem): Promise<void> {
  const { payload } = item;
  const labels = labelGroupFor(item);

  await runCypher(
    `MERGE (n:${labels} {role_profile_id: $roleProfileId})
     SET n.vertical = $vertical,
         n.role = $role,
         n.status = $status,
         n.updated_at = datetime()`,
    {
      roleProfileId: payload.role_profile_id,
      vertical: payload.vertical,
      role: payload.role,
      status: payload.status,
    }
  );
}

async function markProcessed(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  id: string
): Promise<void> {
  await supabase
    .from("entity_sync_queue")
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("id", id);
}

async function markFailed(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  item: SyncQueueItem,
  err: unknown
): Promise<"retry-scheduled" | "dead_letter"> {
  const attempts = item.attempts + 1;
  const errorMessage = err instanceof Error ? err.message : String(err);

  if (attempts >= MAX_ATTEMPTS) {
    await supabase
      .from("entity_sync_queue")
      .update({
        status: "dead_letter",
        attempts,
        error: errorMessage,
        processed_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    return "dead_letter";
  }

  const delayMinutes = Math.min(2 ** attempts, MAX_BACKOFF_MINUTES);
  const nextAttemptAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();

  await supabase
    .from("entity_sync_queue")
    .update({
      status: "pending", // stays actionable — just not until next_attempt_at elapses
      attempts,
      next_attempt_at: nextAttemptAt,
      error: errorMessage,
    })
    .eq("id", item.id);
  return "retry-scheduled";
}
