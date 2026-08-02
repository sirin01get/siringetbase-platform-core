import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Dead-letter sweep for stuck document-intelligence extraction jobs — the
// real fix for the "stuck at processing forever" bug named in
// ../../../document-intelligence/PERFORMANCE_STRATEGY.md's Phase 1.
//
// model-gateway.ts's withTimeout() wraps every env.AI call (runVisionModel,
// runTextModel, convertToMarkdown) in a 90s Promise.race() timeout, which
// SHOULD force extractDocument()'s own try/catch (extract.ts) to reach a
// terminal status even when Workers AI itself never responds. Verified in
// production that it doesn't reliably do that: two separate live test
// uploads (one against each of two consecutive deploys — the second one
// closing a real gap the first had left in convertToMarkdown()) both sat in
// extraction_jobs.status='processing' 60s+ past that 90s window with no
// revert ever firing. The working theory is a Cloudflare Workers runtime
// limitation, not a bug in this timeout logic: a setTimeout scheduled
// inside a promise racing an in-flight `env.AI` binding call doesn't
// reliably fire while that binding call is still pending inside the same
// isolate.
//
// This sweep doesn't depend on the stuck request's own timers ever firing.
// It's a COMPLETELY SEPARATE Worker invocation — this one, riding
// worker.ts's existing every-minute Cron Trigger rather than a new one (see
// that file's header comment: Workers' free-plan cap is 3 Cron Triggers per
// Worker, and all 3 were already spoken for) — that looks at
// extraction_jobs from the outside and force-fails anything that's been
// 'processing' too long. Even if the original request's isolate is
// genuinely wedged forever on an env.AI call that never settles, this scan
// runs in its own fresh invocation a minute later and is completely
// unaffected by that.
//
// STUCK_THRESHOLD_MINUTES is deliberately generous — not tuned to
// model-gateway.ts's 90s per-call timeout (which, per the above, can't be
// trusted to bound anything on its own right now) but to "how long is
// clearly too long for ANY real extraction to still be running," including
// the slowest realistic path: the scanned-PDF OCR fallback's sequential
// per-page vision calls (extract.ts's OCR branch, up to MAX_OCR_PAGES calls
// back-to-back). A real, eventually-successful extraction finishes in well
// under this; only a genuinely wedged job should ever get swept.
const STUCK_THRESHOLD_MINUTES = 6;

export async function sweepStuckExtractionJobs(): Promise<{ swept: number }> {
  const supabase = createSupabaseServiceRoleClient();
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60_000).toISOString();

  const { data: stuckJobs, error } = await supabase
    .from("extraction_jobs")
    .select("id, document_id, created_at")
    .eq("status", "processing")
    .lt("created_at", cutoff);

  if (error) {
    console.error("sweepStuckExtractionJobs: could not query extraction_jobs:", error.message);
    return { swept: 0 };
  }
  if (!stuckJobs || stuckJobs.length === 0) return { swept: 0 };

  let swept = 0;
  for (const job of stuckJobs) {
    const reason = `Dead-letter sweep: still 'processing' more than ${STUCK_THRESHOLD_MINUTES} minutes after being created (job created ${job.created_at}) — the Workers AI call this job was waiting on never returned.`;

    // Guarded with .eq("status", "processing") — if extractDocument() itself
    // actually completed (or failed) in the moment between the select above
    // and this update, that guard makes this a harmless no-op instead of
    // clobbering a real result. select("id") back so `swept` only counts
    // jobs THIS sweep actually changed, not ones a race made it skip.
    const { data: updatedJob } = await supabase
      .from("extraction_jobs")
      .update({ status: "failed", raw_output: { error: reason }, completed_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "processing")
      .select("id");

    if (!updatedJob || updatedJob.length === 0) continue;

    // Same guarded-revert shape as trigger.ts/retry.ts — only touch
    // documents.status if it's still sitting at 'extraction_queued' (i.e.
    // nothing else already gave this document a real terminal status in
    // the meantime).
    await supabase
      .from("documents")
      .update({ status: "extraction_failed" })
      .eq("id", job.document_id)
      .eq("status", "extraction_queued");

    swept++;
  }

  if (swept > 0) {
    console.log(`sweepStuckExtractionJobs: swept ${swept} stuck extraction job(s).`);
  }
  return { swept };
}
