import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createRawClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { env } from "@/config/env";

// Server client for Server Components / Route Handlers — runs as the
// signed-in user and respects RLS. Use this for anything that should
// honor RLS server-side.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database, "siringetbase">(env.supabaseUrl(), env.supabaseAnonKey(), {
    db: { schema: "siringetbase" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a context that can't set cookies — safe to ignore as
          // long as middleware refreshes the session elsewhere.
        }
      },
    },
  });
}

// Service-role client — bypasses RLS entirely. Reserved for trusted,
// server-only operations: the entity-graph sync job draining
// entity_sync_queue, the payments escrow release/reverse primitives acting
// across role_profiles that aren't the calling user's own. Per
// ../../security/README.md Tier 1, this key is a Worker Secret, never
// exposed to the client, and this function must never be imported into
// anything reachable from the browser.
export function createSupabaseServiceRoleClient() {
  return createRawClient<Database, "siringetbase">(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    db: { schema: "siringetbase" },
    auth: { persistSession: false },
  });
}
