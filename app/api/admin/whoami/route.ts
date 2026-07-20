import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";

// Backs src/components/admin/AdminGate.tsx's client-side check — mirrors
// cafocus/app's identical route exactly.
export async function GET(request: Request) {
  const auth = await requireAdmin(request, "whoami", ["business_admin", "support_admin"]);
  if (!auth.ok) return auth.response;

  return NextResponse.json({ status: "ok", admin: { email: auth.actor.email, role: auth.actor.role } });
}
