-- Soft-delete for siringetbase.admin_audit_log — the owner's request: "The
-- admin user shall be able to delete the log. give suitable search
-- criterion as well. The log shall go to a hidden bin from where it shall
-- be trashed out every week."
--
-- "Hidden bin", not immediate hard-delete: deleted_at marks a row as
-- binned. cafocus/app's GET /api/admin/audit-log (src/lib/admin/audit-log.ts)
-- excludes deleted_at is not null by default, which is what makes it
-- "hidden" — the row still physically exists until the weekly purge
-- actually removes it. Deleting is itself an audited action
-- (action: 'audit_log.delete', written by the same admin_audit_log table
-- it's deleting FROM) — an audit log that could be silently, untraceably
-- erased would defeat its own purpose, so the delete action leaves its own
-- trail even though the original entries it deleted eventually get purged.
--
-- Purge is a platform-core Cron Trigger, not a cafocus/app API call —
-- worker.ts already has a working scheduled() handler (drains
-- entity_sync_queue every minute); this adds a second, weekly cron
-- (wrangler.jsonc) that calls src/lib/admin/audit-log-purge.ts's
-- purgeDeletedAuditLogEntries(), which hard-deletes every row with
-- deleted_at set — "trashed out every week" is read as "the bin gets
-- emptied on a weekly schedule", not "each row waits exactly 7 days from
-- its own deletion."
alter table siringetbase.admin_audit_log
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_role_profile_id uuid references siringetbase.role_profiles(id);

-- Used both by the "hide binned rows from the default view" filter and by
-- the weekly purge's "everything currently binned" sweep.
create index if not exists admin_audit_log_deleted_at_idx
  on siringetbase.admin_audit_log(deleted_at)
  where deleted_at is not null;

-- Rollback:
--   drop index if exists siringetbase.admin_audit_log_deleted_at_idx;
--   alter table siringetbase.admin_audit_log
--     drop column if exists deleted_by_role_profile_id,
--     drop column if exists deleted_at;
