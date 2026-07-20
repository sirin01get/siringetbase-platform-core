import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Writes to siringetbase.admin_audit_log
// (../../../supabase/migrations/0010_admin_audit_log.sql) — mirrors
// cafocus/app's src/lib/admin/audit.ts exactly, just `app: "platform-core"`
// and using this app's own service-role client (same physical table either
// way, this Worker's client already targets the siringetbase schema
// directly, so no separate cross-schema client is needed the way
// cafocus/app needs createSiringetbaseServiceRoleClient()). Best-effort,
// never throws.
interface AuditActor {
  roleProfileId: string | null;
  userId: string | null;
  email: string | null;
  role: string | null;
}

interface WriteAuditLogParams {
  actor: AuditActor;
  action: string;
  targetType?: string;
  targetId?: string;
  outcome: "success" | "denied" | "error";
  detail?: Record<string, unknown>;
  request?: Request;
}

export async function writeAuditLog(params: WriteAuditLogParams): Promise<void> {
  try {
    const siringetbase = createSupabaseServiceRoleClient();
    await siringetbase.from("admin_audit_log").insert({
      actor_role_profile_id: params.actor.roleProfileId,
      actor_user_id: params.actor.userId,
      actor_email: params.actor.email,
      actor_role: params.actor.role,
      app: "platform-core",
      action: params.action,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      outcome: params.outcome,
      detail: params.detail ?? {},
      ip_address: params.request?.headers.get("cf-connecting-ip") ?? params.request?.headers.get("x-forwarded-for") ?? null,
      user_agent: params.request?.headers.get("user-agent") ?? null,
    });
  } catch (err) {
    console.error(`admin_audit_log write failed for action "${params.action}":`, err);
  }
}
