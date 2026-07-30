import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/config/env";
import type { Database } from "@/lib/supabase/types";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function csrfRejection(): NextResponse {
  return NextResponse.json({ status: "error", message: "Cross-origin request blocked." }, { status: 403 });
}

// Enterprise-gap fix — see cafocus/app/middleware.ts's identical function
// for the full reasoning (OWASP's Origin-verification CSRF defense, why
// absent headers pass rather than fail). Same trade-off here matters even
// more: this Worker's own comms/document-intelligence routes are called
// server-to-server from cafocus/app with no Origin/Sec-Fetch-Site header
// at all, and those calls must keep working.
function checkSameOrigin(request: NextRequest): NextResponse | null {
  if (!UNSAFE_METHODS.has(request.method)) return null;

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite) {
    if (secFetchSite === "same-origin" || secFetchSite === "none") return null;
    return csrfRejection();
  }

  const origin = request.headers.get("origin");
  if (!origin) return null;

  if (origin === request.nextUrl.origin) return null;
  return csrfRejection();
}

// Standard @supabase/ssr session-refresh middleware — first real browser
// auth flow in this app. Until now this Worker was API-only plus two
// unauthenticated admin pages (billing, sync-queue); real
// business_admin/support_admin accounts (see src/lib/admin/auth.ts and
// ../../cafocus/app's identical pattern, which this mirrors) need a
// signed-in session that survives across requests, same reason
// cafocus/app has had this since its own Phase 2 CA onboarding. Schema
// doesn't matter for auth calls (getUser() talks to GoTrue, not
// PostgREST), "siringetbase" here is just for a consistent Database type
// — same as src/lib/supabase/server.ts.
export async function middleware(request: NextRequest) {
  // See checkSameOrigin()'s comment for why this runs first and ahead of
  // /api too (the matcher below no longer excludes it).
  const csrfBlock = checkSameOrigin(request);
  if (csrfBlock) return csrfBlock;

  if (request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database, "siringetbase">(env.supabaseUrl(), env.supabasePublishableKey(), {
    db: { schema: "siringetbase" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Triggers a token refresh if the current session is stale — the point of
  // this middleware; the return value itself isn't used here.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // /api is no longer excluded — see cafocus/app/middleware.ts's
    // identical matcher-comment update for why.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
