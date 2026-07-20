import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { writeAuditLog } from "./audit";

// Real admin identity for this app's own /admin/* pages (billing,
// sync-queue) — mirrors cafocus/app's src/lib/admin/auth.ts exactly (same
// role_profiles rows, same two roles, same shared siringetbase.role_profiles
// table — an admin account works identically in both apps, they just each
// have their own session since they're separate Cloudflare Worker
// deployments/origins). "business admin" (CA verification, referral
// invites over in cafocus/app, and this app's /admin/billing — platform
// charges) and "support admin" (cafocus/app's disputes, and this app's
// /admin/sync-queue) — the owner's own naming. No self-registration — see
// README.md "Access control".
export type AdminRole = "business_admin" | "support_admin";

export interface AdminActor {
  roleProfileId: string;
  userId: string;
  email: string | null;
  role: AdminRole;
}

export async function getAdminRoleProfile(userId: string, allowedRoles: AdminRole[]): Promise<{ id: string; role: AdminRole } | null> {
  const siringetbase = createSupabaseServiceRoleClient();
  const { data } = await siringetbase
    .from("role_profiles")
    .select("id, role")
    .eq("user_id", userId)
    .eq("vertical", "siringetbase")
    .in("role", allowedRoles)
    .eq("status", "active")
    .maybeSingle();

  return data ? { id: data.id, role: data.role as AdminRole } : null;
}

// Session + role check for every /api/admin/* route in this app, in one
// call — same shape as cafocus/app's requireAdmin(), duplicated rather
// than imported since these are separate deployable Workers with no shared
// import path (same reasoning as every other cross-Worker helper in this
// build). Writes a 'denied' audit entry on either failure path.
export async function requireAdmin(
  request: Request,
  action: string,
  allowedRoles: AdminRole[]
): Promise<{ ok: true; actor: AdminActor } | { ok: false; response: NextResponse }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    await writeAuditLog({
      actor: { roleProfileId: null, userId: null, email: null, role: null },
      action,
      outcome: "denied",
      detail: { reason: "not signed in" },
      request,
    });
    return {
      ok: false,
      response: NextResponse.json({ status: "error", message: "Sign in first." }, { status: 401 }),
    };
  }

  const admin = await getAdminRoleProfile(user.id, allowedRoles);
  if (!admin) {
    await writeAuditLog({
      actor: { roleProfileId: null, userId: user.id, email: user.email ?? null, role: null },
      action,
      outcome: "denied",
      detail: { reason: "not an authorized admin role for this action", allowedRoles },
      request,
    });
    return {
      ok: false,
      response: NextResponse.json({ status: "error", message: "Not authorized." }, { status: 403 }),
    };
  }

  return {
    ok: true,
    actor: { roleProfileId: admin.id, userId: user.id, email: user.email ?? null, role: admin.role },
  };
}
