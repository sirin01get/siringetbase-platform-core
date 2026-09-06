import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { timingSafeEqual } from "@/lib/comms/verify-webhook";
import { getExtractionQueue, type ExtractionQueueMessage } from "@/lib/document-intelligence/queue";
import { extractDocumentFromR2 } from "@/lib/document-intelligence/extract-from-r2";
import { rateLimitOrNull } from "@/lib/security/rate-limit";

// POST /api/internal/document-intelligence/enqueue-batch — the bulk-upload
// counterpart to .../extract/route.ts, same "Two Entry Points" cross-Worker
// shape (secret-header-protected, single trusted caller per vertical), but
// a deliberately different SHAPE of request and a deliberately narrower
// job: the caller (cafocus/app's src/lib/documents/service.ts) has ALREADY
// created the siringetbase.document_batches row and every
// siringetbase.documents row (each tagged with batch_id) BEFORE calling
// this, and has ALREADY uploaded every file straight into its own R2
// bucket — see cafocus/app's src/lib/document-intelligence/bulk-trigger.ts
// header comment for the full reasoning. This route's only job is
// dispatching each already-recorded document to the extraction queue (or
// its inline fallback); it never touches document_batches or documents
// itself, and never receives raw file bytes.
//
// Fails OPEN onto inline processing, not onto an error, when the Cloudflare
// Queue account resource hasn't been provisioned yet
// (`wrangler queues create document-extraction-queue`, see wrangler.jsonc's
// comment) — the bulk-upload FEATURE must work the moment this code
// deploys, even before that one-time setup step happens; it just doesn't
// get real cross-invocation parallelism until it does. Same fail-open
// posture this codebase already applies to Neo4j, the comms DB-template
// lookup, and rate limiting.

function errorResponse(httpCode: number, message: string) {
  return NextResponse.json({ status: "error", message }, { status: httpCode });
}

interface EnqueueBatchBody {
  batch_id: string;
  items: Array<{ document_id: string; r2_key: string; content_type: string }>;
}

// Deliberately capped well below any Cloudflare Queue message-count limit —
// this is about keeping the INLINE fallback path (no queue provisioned yet)
// within one request's reasonable wall-clock budget, since that path awaits
// every extraction before responding. A genuinely large batch should be
// split into multiple bulk-upload actions by the caller rather than this
// route silently truncating one; see cafocus/app's DocumentIntake.tsx bulk
// mode, which caps a single selection at the same number.
const MAX_BATCH_ITEMS = 100;

// Same conservative concurrency reasoning as queue-consumer.ts's
// BATCH_MESSAGE_CONCURRENCY — this is the inline-fallback path's equivalent
// dial, used only when no Cloudflare Queue is configured.
const INLINE_FALLBACK_CONCURRENCY = 3;

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) return;
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-document-intelligence-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, env.documentIntelligenceInternalSecret())) {
    return errorResponse(401, "Missing or invalid x-document-intelligence-internal-secret header");
  }

  // Same cost-inflation safety valve as extract/route.ts, reused rather than
  // a second bucket — this route's real cost driver is the same thing
  // (Workers AI/OpenAI/Gemini calls), just batched.
  const rateLimited = await rateLimitOrNull("RL_EXTRACT", "extract:global");
  if (rateLimited) return rateLimited;

  let body: EnqueueBatchBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Expected a JSON body.");
  }

  if (!body.batch_id) {
    return errorResponse(400, "batch_id is required.");
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return errorResponse(400, "items must be a non-empty array.");
  }
  if (body.items.length > MAX_BATCH_ITEMS) {
    return errorResponse(400, `A single batch is capped at ${MAX_BATCH_ITEMS} files — split larger uploads into more than one batch.`);
  }
  for (const item of body.items) {
    if (!item.document_id || !item.r2_key || !item.content_type) {
      return errorResponse(400, "Each item requires document_id, r2_key, and content_type.");
    }
  }

  const queue = getExtractionQueue();

  if (queue) {
    // Real path — one message per document, real cross-invocation
    // parallelism via queue-consumer.ts + wrangler.jsonc's consumer
    // max_concurrency. send() resolves once the message is durably
    // enqueued, not once it's processed — this route returns immediately,
    // same "don't make the uploader wait on inference" posture as the
    // original trigger.ts's ctx.waitUntil() background fetch.
    await Promise.all(
      body.items.map((item) => {
        const message: ExtractionQueueMessage = {
          documentId: item.document_id,
          r2Key: item.r2_key,
          contentType: item.content_type,
        };
        return queue.send(message);
      })
    );
    return NextResponse.json({ status: "ok", batch_id: body.batch_id, mode: "queued", count: body.items.length });
  }

  // Fallback — no Cloudflare Queue provisioned yet on this deployment (see
  // this file's header comment). Still correct, just without real
  // cross-invocation parallelism: bounded in-process concurrency within
  // this one request instead.
  await mapWithConcurrency(body.items, INLINE_FALLBACK_CONCURRENCY, async (item) => {
    try {
      await extractDocumentFromR2({
        documentId: item.document_id,
        r2Key: item.r2_key,
        contentType: item.content_type,
      });
    } catch (err) {
      console.error("enqueue-batch inline fallback: extraction threw", item.document_id, err);
    }
  });

  return NextResponse.json({ status: "ok", batch_id: body.batch_id, mode: "inline", count: body.items.length });
}
