// Cloudflare Queue consumer for bulk document extraction — the "additional
// AI agents doing parallel processing" piece of the owner's bulk-upload ask.
//
// How the parallelism is real, not simulated: Cloudflare invokes a queue
// consumer's handler with its own `max_concurrency` setting (wrangler.jsonc)
// — when a batch upload enqueues, say, 40 messages, Cloudflare runs SEVERAL
// concurrent consumer invocations (each its own isolate, each pulling its
// own batch of up to `max_batch_size` messages) rather than one Worker
// churning through all 40 one at a time. That is the actual mechanism behind
// "additional AI agents at Cloudflare doing parallel processing" — there's
// no separate literal "agent" construct on this platform beyond concurrent
// Worker invocations, and dressing this up as anything more elaborate would
// overstate what's really happening. Within EACH invocation's own batch,
// this file adds a second, smaller layer of concurrency (bounded, same
// mapWithConcurrency-style pattern extract.ts already uses for scanned-PDF
// OCR pages) so one invocation's handful of messages also don't run fully
// sequentially.
//
// Per-message ack/retry (not one bulk ack for the whole batch): a single
// unreadable document must never block or repeat every OTHER document in
// the same batch. `message.retry()` uses Cloudflare's own configured
// backoff/max_retries (wrangler.jsonc); after those are exhausted the
// message lands on the configured dead_letter_queue automatically — no
// custom dead-letter bookkeeping needed here, unlike
// dead-letter-sweep.ts's entity_sync_queue (a plain Postgres outbox with no
// built-in DLQ of its own).

import { extractDocumentFromR2 } from "./extract-from-r2";
import type { ExtractionQueueMessage } from "./queue";

// Mirrors extract.ts's own OCR_PAGE_CONCURRENCY reasoning: a deliberately
// conservative starting point, not unbounded — each message is its own
// Workers AI (or OpenAI/Gemini fallback) round trip, and extract.ts's
// existing circuit breaker + rate-limit-shaped safety valves were designed
// around the ORIGINAL one-request-one-document path. Combined with
// wrangler.jsonc's consumer `max_concurrency`, this is the second of two
// deliberately small dials on total concurrent extraction throughput — see
// that file's comment for how the two combine.
const BATCH_MESSAGE_CONCURRENCY = 3;

export async function processExtractionQueueBatch(batch: {
  messages: Array<{
    body: ExtractionQueueMessage;
    ack: () => void;
    retry: () => void;
  }>;
}): Promise<void> {
  const messages = batch.messages;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= messages.length) return;
      const message = messages[i];
      if (!message) return;

      try {
        const outcome = await extractDocumentFromR2(message.body);
        // "failed" is still a TERMINAL, successfully-processed outcome —
        // extractDocumentFromR2()/extractDocument() already wrote the
        // extraction_jobs/documents rows recording the failure reason.
        // Retrying would just repeat the same deterministic failure (a
        // genuinely malformed document doesn't become readable on attempt
        // 2) and waste a Workers AI/OpenAI/Gemini call doing it — ack it
        // like any other completed message. Only a THROWN error below (the
        // R2 read itself failing, a transient network blip) is worth
        // Cloudflare's own retry/backoff.
        void outcome;
        message.ack();
      } catch (err) {
        console.error("processExtractionQueueBatch: message failed, will retry", message.body, err);
        message.retry();
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(BATCH_MESSAGE_CONCURRENCY, messages.length) }, () => worker())
  );
}
