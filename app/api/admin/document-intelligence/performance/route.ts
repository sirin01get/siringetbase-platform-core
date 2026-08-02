import { NextResponse } from "next/server";
import { getDashboardSummary, getMaxTokensAudit, getCorrectionMiningReport } from "@/lib/document-intelligence/metrics";
import { requireAdmin } from "@/lib/admin/auth";

// Read-only reporting endpoint backing
// app/admin/document-intelligence/performance/page.tsx — see
// ../../../../../src/lib/document-intelligence/metrics.ts's header comment
// for what each of the three sections is and which PERFORMANCE_STRATEGY.md
// item it closes. One route returning all three rather than three separate
// endpoints: they share the same underlying query (the last 500
// extraction_jobs rows) and are always viewed together on one page, so
// three round trips would just be three copies of the same fetch.
export async function GET(request: Request) {
  const auth = await requireAdmin(request, "document_intelligence.performance.view", ["business_admin"]);
  if (!auth.ok) return auth.response;

  try {
    const [summary, maxTokensAudit, correctionMining] = await Promise.all([
      getDashboardSummary(),
      getMaxTokensAudit(),
      getCorrectionMiningReport(),
    ]);
    return NextResponse.json({ status: "ok", summary, maxTokensAudit, correctionMining });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not load performance report." },
      { status: 500 }
    );
  }
}
