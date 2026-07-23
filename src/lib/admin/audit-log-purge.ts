import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Weekly "empty the bin" job — the owner's request on cafocus/app's audit
// log delete feature: "The log shall go to a hidden bin from where it
// shall be trashed out every week." cafocus/app's
// src/lib/admin/audit-log.ts soft-deletes (sets deleted_at) rather than
// really deleting, so a binned row still exists until THIS actually
// removes it — called from worker.ts's scheduled() handler, on the
// weekly cron entry in wrangler.jsonc (separate from the existing
// every-minute entity_sync_queue drain).
//
// "Trashed out every week" is read as "the bin gets emptied on a weekly
// schedule" — every row with deleted_at set at the moment this runs is
// gone, not "each row waits exactly 7 days from its own deletion." Lives
// here rather than in cafocus/app because this app already has a working
// Cron Trigger + scheduled() handler (worker.ts) and already owns the
// siringetbase schema admin_audit_log lives in — cafocus/app has neither.
export async function purgeDeletedAuditLogEntries(): Promise<{ purged: number }> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("admin_audit_log")
    .delete()
    .not("deleted_at", "is", null)
    .select("id");

  if (error) {
    console.error("purgeDeletedAuditLogEntries failed:", error.message);
    return { purged: 0 };
  }

  const purged = (data ?? []).length;
  console.log(`purgeDeletedAuditLogEntries: purged ${purged} binned admin_audit_log row(s).`);
  return { purged };
}
