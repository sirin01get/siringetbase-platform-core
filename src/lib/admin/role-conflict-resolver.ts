import type { AdminRole } from "./auth";

// Exact mirror of cafocus/app's src/lib/admin/role-conflict-resolver.ts —
// duplicated rather than imported, same reasoning as every other
// cross-Worker helper in this build (separate deployable Workers, no
// shared import path). See ../../../../admin/README.md for the full
// strategy doc; keep both copies in sync if either changes.
//
// The seam a real SOX-style role-conflict resolver plugs into later. As of
// this change, one Supabase Auth account CAN hold more than one active
// admin role_profile row at once (business_admin AND support_admin
// simultaneously) — cafocus/app's src/lib/admin/staff.ts and
// scripts/grant-admin.mjs grant additively now instead of overwriting.
// Since role_profiles is the SAME shared table both apps read (this app
// never grants/revokes itself — see README.md "Access control" — it only
// reads), a dual-role account granted from cafocus/app is dual-role here
// too automatically; this resolver is what decides which role "wins" when
// a page/action here (billing, sync-queue) accepts either.
export interface AdminRoleCandidate {
  id: string;
  role: AdminRole;
}

export interface RoleConflictContext {
  userId: string;
  email: string | null;
  /** The audit-log action string of whatever the caller is about to do. Unused by today's stub. */
  action: string;
  /** Every active admin role_profile this user holds that also satisfies the caller's allowedRoles filter. Always non-empty when this is called. */
  candidates: AdminRoleCandidate[];
}

const ROLE_PRIORITY: AdminRole[] = ["business_admin", "support_admin"];

export interface RoleConflictResolution {
  resolved: AdminRoleCandidate;
  hadConflict: boolean;
  otherRoles: AdminRole[];
}

// TODO(sox-compliance): the "empty SOX compliance which approves
// everything" stub, by explicit instruction — never blocks, never asks,
// never checks whether `action` is one where dual-role access is itself a
// conflict. See ../../../../admin-access/README.md's "Future SOX
// compliance strategy" section for what a real version needs to do.
export function resolveAdminRoleConflict(context: RoleConflictContext): RoleConflictResolution {
  if (context.candidates.length === 0) {
    throw new Error("resolveAdminRoleConflict() called with no candidates — caller bug, not a valid conflict state.");
  }

  if (context.candidates.length === 1) {
    return { resolved: context.candidates[0]!, hadConflict: false, otherRoles: [] };
  }

  let resolved: AdminRoleCandidate = context.candidates[0]!;
  for (const role of ROLE_PRIORITY) {
    const match = context.candidates.find((c) => c.role === role);
    if (match) {
      resolved = match;
      break;
    }
  }

  const otherRoles = context.candidates.filter((c) => c.id !== resolved.id).map((c) => c.role);

  return { resolved, hadConflict: true, otherRoles };
}
