import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";

// Backs src/components/admin/AdminGate.tsx's client-side check — mirrors
// cafocus/app's identical route exactly, `roles` included (see that
// route's header comment for why AdminGate must authorize against the
// full role set, not just the resolved "primary" role).
export async function GET(request: Request) {
  const auth = await requireAdmin(request, "whoami", ["business_admin", "support_admin"]);
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    status: "ok",
    admin: {
      email: auth.actor.email,
      role: auth.actor.role,
      otherActiveRoles: auth.actor.otherActiveRoles,
      roles: [auth.actor.role, ...auth.actor.otherActiveRoles],
    },
  });
}
