import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/config/env";
import type { Database } from "@/lib/supabase/types";

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
    // Skip static assets and anything under /api — API routes create their
    // own request-scoped server client (see src/lib/supabase/server.ts) and
    // don't need cookies rewritten by middleware.
    "/((?!_next/static|_next/image|favicon.ico|api).*)",
  ],
};
