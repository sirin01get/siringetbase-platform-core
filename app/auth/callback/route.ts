import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// PKCE magic-link callback — mirrors cafocus/app's app/auth/callback/route.ts
// exactly (same Supabase project, same GoTrue instance, same mechanism).
// src/components/admin/AdminSignInForm.tsx's signInWithOtp() redirects here
// with a `code` param after the admin clicks the emailed link; exchanging
// it for a session sets the auth cookies via createSupabaseServerClient()'s
// cookie adapter, then this redirects on to `next` (defaulted to /admin).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/admin";

  if (!code) {
    return NextResponse.redirect(`${origin}/admin/login?error=missing_code`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/admin/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
