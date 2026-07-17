import { runCypher } from "@/lib/neo4j/client";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Roles that make an entity a `:ServiceProvider` in the entity graph — and,
// per ../../billing/README.md, opt it into revenue-share billing. Extend
// this set when a vertical adds a new earner role; nothing else needs to
// change for that role to be correctly graphed and billed. Everything NOT
// in this set (individual, homebuyer, smb_owner, admin, ...) stays a plain
// :Person or :Business — a payer, never an earner.
const SERVICE_PROVIDER_ROLES = new Set(["ca", "builder", "architect"]);

interface SyncQueueItem {
  id: string;
  operation: "upsert" | "delete";
  payload: {
    role_profile_id: string;
    user_id: string | null;
    business_id: string | null;
    vertical: string;
    role: string;
    status: string;
  };
}

// Drains up to `batchSize` pending entity_sync_queue rows (see
// 0001_init.sql's enqueue_entity_sync trigger), upserting the corresponding
// node in Neo4j for each via the Query API (../../src/lib/neo4j/client.ts —
// no Bolt session/connection pool to manage here, each row is one stateless
// HTTPS request). Postgres stays the source of truth throughout — this
// function only ever reads from Postgres and writes to Neo4j, never the
// reverse (../../entity-graph/README.md's sync contract).
//
// Intended to run on a schedule (Cloudflare Cron Trigger) once deployed;
// exposed via app/api/entity-graph/sync/route.ts for manual/scheduled
// invocation in the meantime.
export async function drainEntitySyncQueue(batchSize = 50): Promise<{ processed: number; failed: number }> {
  const supabase = createSupabaseServiceRoleClient();

  const { data: items, error } = await supabase
    .from("entity_sync_queue")
    .select("id, operation, payload")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (error) throw new Error(`Failed to read entity_sync_queue: ${error.message}`);
  if (!items || items.length === 0) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;

  for (const item of items as SyncQueueItem[]) {
    try {
      if (item.operation === "upsert") {
        await upsertNode(item);
      }
      // 'delete' intentionally unimplemented in Phase 0 — no vertical
      // soft-deletes a role_profile yet. Add a matching case here when one does.

      await supabase
        .from("entity_sync_queue")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("id", item.id);
      processed += 1;
    } catch (err) {
      await supabase
        .from("entity_sync_queue")
        .update({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          processed_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      failed += 1;
    }
  }

  return { processed, failed };
}

async function upsertNode(item: SyncQueueItem) {
  const { payload } = item;
  const isServiceProvider = SERVICE_PROVIDER_ROLES.has(payload.role);
  const baseLabel = payload.user_id ? "Person" : "Business";
  // Neo4j labels can't be query parameters — this interpolation is safe
  // because both operands are from a fixed, code-controlled set (baseLabel
  // is always "Person"/"Business", isServiceProvider is a boolean), never
  // from raw user input.
  const labels = isServiceProvider ? `${baseLabel}:ServiceProvider` : baseLabel;

  // MERGE on role_profile_id (the uniqueness constraint key from
  // schema.cypher) — idempotent, so reprocessing a row after a partial
  // failure never creates a duplicate node.
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
