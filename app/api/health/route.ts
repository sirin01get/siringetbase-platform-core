import { NextResponse } from "next/server";

// Minimal liveness check — no dependency on Supabase or Neo4j so it stays
// useful even before either is configured. Deployment smoke tests hit this
// first, same pattern as homeai/homeai's /api/health.
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "siringetbase-platform-core",
    phase: 0,
  });
}
