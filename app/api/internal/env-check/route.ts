import { NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { buildEnvCheckReport } from "@/lib/admin/env-check";

// Cross-Worker entry point for a vertical's combined env-check dashboard to
// read THIS deployment's report — cafocus/app's (app/admin/env-check/page.tsx
// there) and, since 2026-08-16, lawforge/app's. Same "trusted callers,
// secret header, not a browser session" shape as
// document-intelligence/extract and comms/notify (a vertical's admin session
// cookie is a different origin and wouldn't be sent here anyway).
//
// Deliberately caller-agnostic: it authenticates the SECRET, not the caller,
// so onboarding another vertical needs no change here — that vertical just
// sets the same ENV_CHECK_INTERNAL_SECRET value. That's the documented
// intent (../../../../env-check/README.md: "platform-core's existing secret
// works for every calling vertical, no new secret needed on platform-core's
// side"), not an oversight.
//
// env.envCheckInternalSecret() is wrapped in its own try/catch rather than
// called directly — the exact lesson from PLATFORM_CORE_BASE_URL missing
// on cafocus/app: a required() throw from *this* var specifically should
// come back as a clean, reportable "not configured" response, not crash
// before the caller (which is itself trying to build a report about
// missing vars) gets any answer at all.
export async function GET(request: Request) {
  let expectedSecret: string;
  try {
    expectedSecret = env.envCheckInternalSecret();
  } catch {
    return NextResponse.json(
      { status: "error", message: "ENV_CHECK_INTERNAL_SECRET is not configured on this deployment." },
      { status: 500 }
    );
  }

  const providedSecret = request.headers.get("x-env-check-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return NextResponse.json(
      { status: "error", message: "Missing or invalid x-env-check-internal-secret header." },
      { status: 401 }
    );
  }

  const report = await buildEnvCheckReport("platform-core");
  return NextResponse.json({ status: "ok", report });
}
