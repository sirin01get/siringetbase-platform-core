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
    // NEXT_PUBLIC_* is inlined into the client bundle at build time and is
    // never secret (it's already visible in browser DevTools in production),
    // so echoing the resolved value back here is safe and — unlike a boolean
    // — actually tells you whether the build baked in a placeholder or the
    // real value, which a "configured: true/false" check cannot distinguish.
    resolvedUrl: supabaseUrl ?? null,
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
        // supabase-js's PostgrestError can come back with an empty .message
        // for some failure shapes (e.g. the PostgREST server responding with
        // a non-standard body, or a proxy/edge intercepting the request
        // before it reaches PostgREST). When that happens the wrapped error
        // tells us nothing, so fall back to a raw fetch against the same
        // endpoint and report the real HTTP status + response body verbatim.
        if (!error.message) {
          const rawProbe = await rawSupabaseProbe(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
          (report.supabase as Record<string, unknown>).rawProbe = rawProbe;
          // The wrapped PostgrestError.message was blank, but the raw probe's
          // body is the same JSON PostgREST always returns — re-run it
          // through the same hint logic so the report is still actionable
          // instead of stuck on the generic fallback.
          if ("body" in rawProbe) {
            try {
              const parsed = JSON.parse(rawProbe.body) as { message?: string; code?: string };
              (report.supabase as Record<string, unknown>).hint = diagnoseSupabaseHint(
                parsed.message ?? "",
                parsed.code
              );
            } catch {
              // Body wasn't JSON (e.g. an HTML error page from a proxy/edge in
              // front of PostgREST) — leave the generic hint, httpStatus/body
              // in rawProbe is the best available signal at that point.
            }
          }
        }
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
      : {
          status: "connection-error",
          error: connectivity.error,
          // Tier 1 secret (../../security/README.md) — never echo the full
          // URI. Just the scheme prefix (e.g. "neo4j+s") is enough to prove
          // whether the value is malformed, with no host/credentials exposed.
          uriScheme: process.env.NEO4J_URI?.includes("://")
            ? process.env.NEO4J_URI.split("://")[0]
            : "(no '://' found in value)",
          uriLength: process.env.NEO4J_URI?.length ?? 0,
        };
  } else {
    report.neo4j = {
      status: "unconfigured",
      hint: "Set NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD.",
    };
  }

  return NextResponse.json(report);
}

// Bypasses supabase-js entirely — hits PostgREST directly so a blank
// PostgrestError.message can't hide the real HTTP status/body. Same
// Accept-Profile header supabase-js sets internally for a schema-scoped
// request, so this reproduces exactly what the SDK call did.
async function rawSupabaseProbe(url: string, serviceRoleKey: string) {
  try {
    const res = await fetch(`${url}/rest/v1/role_profiles?select=id&limit=1`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Accept-Profile": "siringetbase",
      },
    });
    const bodyText = await res.text();
    return {
      httpStatus: res.status,
      httpStatusText: res.statusText,
      body: bodyText.slice(0, 500), // cap it — never expects secrets, but keep the report small
    };
  } catch (err) {
    return { fetchThrew: err instanceof Error ? err.message : String(err) };
  }
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
