import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Phase 5 item 12 of ../../../document-intelligence/PERFORMANCE_STRATEGY.md
// — see supabase/migrations/0032_extraction_events.sql's header comment for
// why this is a durable outbox table rather than an in-memory pub/sub (the
// latter doesn't survive across Cloudflare Workers isolates/requests).
// writeExtractionCompletedEvent() is called from extract.ts's
// extractDocument() the moment a job reaches status='completed';
// listUnconsumedEvents()/markEventsConsumed() are what a future consumer
// (or, today, the admin dashboard) reads/acknowledges through.

export interface ExtractionEventRow {
  id: string;
  jobId: string;
  documentId: string;
  vertical: string;
  documentType: string;
  eventType: "extraction.completed";
  payload: Record<string, unknown>;
  createdAt: string;
  consumedAt: string | null;
}

// Best-effort, non-blocking: called right after extractDocument() already
// wrote its own terminal extraction_jobs/documents status — a failure to
// write the EVENT row should never retroactively make an otherwise-
// successful extraction look failed to its caller. Errors are swallowed
// here (logged, not thrown) for exactly that reason; extractDocument()
// doesn't need a try/catch of its own around this call.
export async function writeExtractionCompletedEvent(params: {
  jobId: string;
  documentId: string;
  vertical: string;
  documentType: string;
  confidence: number;
  modelProvider: string;
}): Promise<void> {
  try {
    const supabase = createSupabaseServiceRoleClient();
    await supabase.from("extraction_events").insert({
      job_id: params.jobId,
      document_id: params.documentId,
      vertical: params.vertical,
      document_type: params.documentType,
      event_type: "extraction.completed",
      payload: {
        confidence: params.confidence,
        modelProvider: params.modelProvider,
      },
    });
  } catch (err) {
    console.error("writeExtractionCompletedEvent: failed to write event row (non-fatal):", err);
  }
}

export async function listExtractionEvents(params: {
  onlyUnconsumed?: boolean;
  limit?: number;
}): Promise<ExtractionEventRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  let query = supabase
    .from("extraction_events")
    .select("id, job_id, document_id, vertical, document_type, event_type, payload, created_at, consumed_at")
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 50);

  if (params.onlyUnconsumed) query = query.is("consumed_at", null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    jobId: r.job_id,
    documentId: r.document_id,
    vertical: r.vertical,
    documentType: r.document_type,
    eventType: r.event_type as "extraction.completed",
    payload: (r.payload as Record<string, unknown>) ?? {},
    createdAt: r.created_at,
    consumedAt: r.consumed_at,
  }));
}

export async function markEventsConsumed(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("extraction_events")
    .update({ consumed_at: new Date().toISOString() })
    .in("id", eventIds)
    .is("consumed_at", null);
  if (error) throw new Error(error.message);
}
