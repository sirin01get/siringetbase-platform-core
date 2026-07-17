import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { checkNeo4jConnectivity } from "@/lib/neo4j/client";

// Structured connection check for both stores this foundation depends on —
// same pattern as homeai/homeai's /api/diagnostics: one JSON object naming
// exactly which layer is broken, not a generic crash screen. Never echoes
// secret values, only whether each is configured.
export async function GET() {
  const report: Record<string, unknown> = { timestamp: new Date().toISOString() };

  // --- Supabase ---
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKeyConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const serviceRoleKeyConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  report.supabase = {
    urlConfigured: Boolean(supabaseUrl),
    anonKeyConfigured,
    serviceRoleKeyConfigured,
  };

  if (supabaseUrl && anonKeyConfigured && serviceRoleKeyConfigured) {
    try {
      const supabase = createSupabaseServiceRoleClient();
      const { error, count } = await supabase
        .from("role_profiles")
        .select("id", { count: "exact", head: true });

      if (error) {
        (report.supabase as Record<string, unknown>).status = "connection-error";
        (report.supabase as Record<string, unknown>).error = error.message;
        (report.supabase as Record<string, unknown>).hint = diagnoseSupabaseHint(
          error.message,
          (error as { code?: string }).code
        );
      } else {
        (report.supabase as Record<string, unknown>).status = "ok";
        (report.supabase as Record<string, unknown>).roleProfilesCount = count ?? 0;
      }
    } catch (err) {
      (report.supabase as Record<string, unknown>).status = "connection-error";
      (report.supabase as Record<string, unknown>).error = err instanceof Error ? err.message : String(err);
    }
  } else {
    (report.supabase as Record<string, unknown>).status = "unconfigured";
    (report.supabase as Record<string, unknown>).hint =
      "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY. " +
      "On Cloudflare, these must be set under Settings > Builds > Build variables and secrets, then redeploy.";
  }

  // --- Neo4j ---
  const neo4jConfigured = Boolean(process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD);
  if (neo4jConfigured) {
    const connectivity = await checkNeo4jConnectivity();
    report.neo4j = connectivity.ok
      ? { status: "ok" }
      : { status: "connection-error", error: connectivity.error };
  } else {
    report.neo4j = {
      status: "unconfigured",
      hint: "Set NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD.",
    };
  }

  return NextResponse.json(report);
}

function diagnoseSupabaseHint(message: string, code: string | null | undefined): string {
  if (code === "PGRST106" || /schema must be one of/i.test(message) || /invalid schema/i.test(message)) {
    return (
      "The `siringetbase` schema isn't exposed to the API yet. Supabase dashboard > Integrations > " +
      "Data API > Settings > Exposed schemas > add `siringetbase` > Save. Can take ~30s to propagate."
    );
  }
  if (/JWT|invalid api key|invalid authentication/i.test(message)) {
    return "The service role key looks wrong or stale — re-copy it from Supabase dashboard > Settings > API.";
  }
  if (/relation .* does not exist/i.test(message)) {
    return "The `siringetbase` schema exists but this table doesn't — 0001_init.sql hasn't been run yet.";
  }
  return "Unrecognized error — see the error field above.";
}
