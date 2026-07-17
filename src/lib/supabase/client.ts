"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";
import { env } from "@/config/env";

// Browser client — respects RLS as the signed-in user. Use from Client
// Components only; never import the service-role client here.
//
// `db.schema: "siringetbase"` points every query at the dedicated schema
// 0001_init.sql creates — must match the "Exposed schemas" dashboard
// setting (see README.md's setup section), same requirement homeai's
// client.ts documents for its own `homeai` schema.
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database, "siringetbase">(env.supabaseUrl(), env.supabasePublishableKey(), {
    db: { schema: "siringetbase" },
  });
}
