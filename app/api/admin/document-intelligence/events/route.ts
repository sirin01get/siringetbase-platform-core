import { NextResponse } from "next/server";
import { listExtractionEvents, markEventsConsumed } from "@/lib/document-intelligence/events";
import { requireAdmin } from "@/lib/admin/auth";
import { writeAuditLog } from "@/lib/admin/audit";

interface ConsumeBody {
  eventIds?: string[];
}

// Admin-facing consumer for siringetbase.extraction_events — see
// ../../../../../src/lib/document-intelligence/events.ts's header comment
// and supabase/migrations/0032_extraction_events.sql for why this table
// exists (Phase 5 item 12 of ../../../document-intelligence/PERFORMANCE_STRATEGY.md,
// the emit(extraction.completed) step the README flagged as
// designed-but-not-built). GET lists recent events (unconsumed-only by
// default, matching the "what's new since I last checked" hot path the
// migration's partial index is built for); POST marks a batch consumed
// once the admin has looked at them. This is the first real consumer —
// an automated subscriber (e.g. a vertical auto-pulling a finished
// extraction into a draft) is still future scope, unchanged by this route.
export async function GET(request: Request) {
  const auth = await requireAdmin(request, "document_intelligence.events.list", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const onlyUnconsumed = searchParams.get("onlyUnconsumed") !== "false";
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  try {
    const rows = await listExtractionEvents({
      onlyUnconsumed,
      limit: limit && Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json({ status: "ok", rows });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not load extraction events." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request, "document_intelligence.events.consume", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as ConsumeBody;
  const eventIds = (body.eventIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);

  if (eventIds.length === 0) {
    return NextResponse.json({ status: "error", message: "eventIds must be a non-empty array." }, { status: 400 });
  }

  try {
    await markEventsConsumed(eventIds);
    await writeAuditLog({
      actor: auth.actor,
      action: "document_intelligence.events.consume",
      targetType: "extraction_event",
      outcome: "success",
      detail: { eventIds },
      request,
    });
    return NextResponse.json({ status: "ok", consumed: eventIds.length });
  } catch (err) {
    await writeAuditLog({
      actor: auth.actor,
      action: "document_intelligence.events.consume",
      outcome: "error",
      detail: { eventIds, error: err instanceof Error ? err.message : String(err) },
      request,
    });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not mark events consumed." },
      { status: 500 }
    );
  }
}
