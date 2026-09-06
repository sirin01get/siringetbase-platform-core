// @ts-nocheck
//
// Binding access for the bulk-extraction Cloudflare Queue and the
// cross-Worker R2 bucket read needed to service it — same
// getCloudflareContext() + `@ts-nocheck` pattern as model-gateway.ts (env.AI)
// and cafocus/app's r2/ca-documents.ts (env.CA_DOCUMENTS): see either of
// those files' header comments for why (@cloudflare/workers-types' globals
// collide with this project's "dom" lib).
//
// Why platform-core reads cafocus/app's OWN R2 bucket directly, rather than
// re-fetching bytes over HTTP the way the original single-document
// extract/route.ts does: an R2 bucket is an account-level resource, not
// something exclusively owned by the Worker that first created it — the
// SAME bucket_name can be bound from more than one Worker's wrangler.jsonc.
// For one document that's a wash either way, but for a bulk upload of many
// files it means the bytes travel over the wire exactly once (cafocus/app's
// browser upload -> its own R2 bucket) instead of twice (once into R2, then
// again over an internal HTTP call to platform-core) — a meaningful chunk of
// "make it really fast" for a large batch. The binding here is used
// read-only in application code (queue-consumer.ts only ever calls .get());
// nothing stops platform-core from writing to it at the wrangler.jsonc
// level, but nothing in this codebase does.
//
// Both bindings are OPTIONAL by design (returns null, never throws) — see
// enqueue-batch/route.ts's header comment for the fallback story this makes
// possible: the feature must keep working (just without real parallelism)
// on a deployment where the account resource this binding points at
// (`wrangler queues create document-extraction-queue`) hasn't been
// provisioned yet.

import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface ExtractionQueueMessage {
  documentId: string;
  r2Key: string;
  contentType: string;
}

export function getExtractionQueue() {
  try {
    const { env } = getCloudflareContext();
    return env.EXTRACTION_QUEUE ?? null;
  } catch {
    // Thrown outside a real Workers runtime request (e.g. plain `next dev`)
    // — same degrade-to-null posture as every other getCloudflareContext()
    // caller in this codebase, never a hard failure.
    return null;
  }
}

export function getCafocusDocumentsBucket() {
  try {
    const { env } = getCloudflareContext();
    return env.CAFOCUS_DOCUMENTS ?? null;
  } catch {
    return null;
  }
}
