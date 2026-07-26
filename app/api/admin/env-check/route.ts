import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { buildEnvCheckReport } from "@/lib/admin/env-check";

// This deployment's own env-check report, for a signed-in admin viewing
// app/admin/env-check/page.tsx directly on platform-core (as opposed to
// cafocus/app's combined dashboard, which reads the same data cross-Worker
// via GET /api/internal/env-check instead — a browser session cookie from
// cafocus/app's origin wouldn't be sent here anyway). Either admin role —
// same posture as /api/diagnostics and every other read-only status check.
export async function GET(request: Request) {
  const auth = await requireAdmin(request, "env_check.view", ["business_admin", "support_admin"]);
  if (!auth.ok) return auth.response;

  const report = await buildEnvCheckReport("platform-core");
  return NextResponse.json({ status: "ok", report });
}
