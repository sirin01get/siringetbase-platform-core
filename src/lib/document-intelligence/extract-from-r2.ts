// R2-backed variant of extractDocument() — the bulk/queue path's entry
// point. extractDocument() itself (./extract.ts) is untouched and stays the
// single shared core for every extraction call site (the original per-
// upload HTTP path, the retry path, and now this one): all of the
// primary/fallback provider chain, confidence gating, and OCR fallback
// logic keeps living in exactly one place. This file's only job is getting
// `imageBytes` from an R2 object instead of from a multipart POST body,
// since a queue MESSAGE carries a documentId + r2Key, not the file bytes
// themselves (Cloudflare Queues messages are size-limited — well under a
// typical PDF or scanned image — and re-fetching from R2 is effectively
// free and instant compared to a model-inference call anyway).

import { getCafocusDocumentsBucket } from "./queue";
import { extractDocument, type ExtractionOutcome } from "./extract";

export async function extractDocumentFromR2(params: {
  documentId: string;
  r2Key: string;
  contentType: string;
}): Promise<ExtractionOutcome> {
  const bucket = getCafocusDocumentsBucket();
  if (!bucket) {
    return {
      status: "failed",
      reason:
        "CAFOCUS_DOCUMENTS R2 binding is not configured on this Worker — see wrangler.jsonc's r2_buckets comment and the document-intelligence README's bulk-upload setup section.",
    };
  }

  const object = await bucket.get(params.r2Key);
  if (!object) {
    return { status: "failed", reason: `Object not found in R2 at key "${params.r2Key}".` };
  }

  const imageBytes = await object.arrayBuffer();
  return extractDocument({ documentId: params.documentId, imageBytes, contentType: params.contentType });
}
