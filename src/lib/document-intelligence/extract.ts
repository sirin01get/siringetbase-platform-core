import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { runVisionModel, runTextModel, convertToMarkdown } from "./model-gateway";
import { extractScannedPdfPageImages, mergeExtractedPages, MAX_OCR_PAGES } from "./pdf-ocr";

// Genuine raster photos go straight to the vision-instruct model unchanged
// (image bytes + prompt). Everything else this pipeline realistically sees
// — PDFs above all, since Form 16/16A/26AS, AIS, and GST invoices are all
// normally downloaded or issued as PDFs, not photographed — is NOT a valid
// `image` param for that model (Workers AI error 3030: "Provided image is
// not compatible or malformed"). Those go through convertToMarkdown()
// first instead. Kept as an explicit allowlist rather than "anything
// image/* goes to vision, else markdown" so an unexpected image subtype
// (e.g. image/heic, which neither path here actually supports) fails with
// a clear reason instead of silently attempting the wrong pipeline.
const VISION_COMPATIBLE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);

// Formats convertToMarkdown() (Workers AI's Markdown Conversion service)
// actually supports — see
// https://developers.cloudflare.com/workers-ai/features/markdown-conversion/supported-formats/
// for the full list; this is the subset relevant to what this pipeline's
// document intake UIs actually let someone upload today.
const MARKDOWN_CONVERTIBLE_TYPES = new Set([
  "application/pdf",
  "text/csv",
  "text/html",
  "application/xml",
  "text/xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function extensionForContentType(contentType: string): string {
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "text/csv": "csv",
    "text/html": "html",
    "application/xml": "xml",
    "text/xml": "xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };
  return map[contentType] ?? "bin";
}

// Extraction orchestration — the "run_extraction(job_id)" step of
// ../../../document-intelligence/README.md's Pipeline (Generic) section,
// called from app/api/document-intelligence/extract/route.ts, the
// cross-Worker entry point every calling vertical's upload flow hits
// (cafocus/app's src/lib/document-intelligence/trigger.ts today).
//
// documents/extraction_templates/extraction_jobs are all siringetbase
// schema tables platform-core owns directly — no cross-schema client
// needed, unlike cafocus/app's siringetbase-admin.ts.
//
// Confidence is a heuristic, not a real model-calibrated score: Workers AI
// vision models don't return one. "All of the template's `required` schema
// fields are present and non-empty" scores higher than "some are missing" —
// crude, but honest about what it actually measures, and it still serves
// ../../../document-intelligence/README.md's Guardrail ("below [confidence_threshold],
// flagged needs_review, cannot silently feed an automated downstream
// action") since nothing downstream reads these results automatically yet
// anyway. Revisit once there's a real accuracy signal to replace it with.

export interface ExtractionOutcome {
  status: "completed" | "failed" | "skipped";
  reason?: string;
  jobId?: string;
  confidence?: number;
}

// Scans forward from the first '{' in `text`, tracking brace depth (and
// skipping braces inside string literals) until that first object closes,
// and returns just that substring. This is deliberately NOT "first '{' to
// LAST '}' in the whole string" — root-caused against a real purchase-
// invoice extraction that failed with exactly that naive approach: the
// model answered correctly once inside a fenced block, then — unprompted —
// restated the same answer a second time under a "JSON output:" heading,
// and that second attempt got cut off by the max_tokens ceiling with no
// closing brace. First-to-last slicing spliced the complete first object
// together with the dangling start of the second, producing a string that
// LOOKED like it had balanced outer braces (there IS a '{' at the start and
// a '}' somewhere near the end) but was actually two objects concatenated —
// invalid JSON either way. Returns null (rather than a best-effort slice)
// if the object never closes, since a truncated object has no valid
// substring to offer.
function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\") {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function stripToJsonObject(text: string): string | null {
  // Model output is a chat-style response, not guaranteed to be bare JSON,
  // and — per extractBalancedJsonObject()'s comment above — sometimes
  // contains more than one attempt at an answer. Collect every fenced
  // ```/```json code block and try them from LAST to FIRST (a model that
  // restates its answer, e.g. loose narration followed by a "JSON output:"
  // block, puts the real/most-refined one last), falling back to the raw,
  // unfenced text if there are no fences at all or none of them parse.
  const fenced: string[] = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    fenced.push(match[1] ?? "");
  }
  const candidates = [...fenced.reverse(), text];

  for (const candidate of candidates) {
    const obj = extractBalancedJsonObject(candidate);
    if (!obj) continue;
    try {
      JSON.parse(obj);
      return obj;
    } catch {
      // Balanced braces but still not valid JSON (e.g. a trailing comma) —
      // try the next candidate rather than giving up immediately.
    }
  }
  return null;
}

function scoreExtraction(
  parsed: unknown,
  outputSchema: Record<string, unknown>
): { confidence: number; missingFields: string[] } {
  const required = Array.isArray(outputSchema.required) ? (outputSchema.required as string[]) : [];
  if (!parsed || typeof parsed !== "object") {
    return { confidence: 0, missingFields: required };
  }
  const obj = parsed as Record<string, unknown>;
  const missingFields = required.filter((key) => obj[key] === undefined || obj[key] === null || obj[key] === "");
  // Heuristic bands: all required fields present -> 0.75; some missing ->
  // scaled down proportionally, floor 0.2 so a mostly-complete extraction
  // doesn't read as a total failure.
  const confidence =
    required.length === 0
      ? 0.6
      : Math.max(0.2, 0.75 * (1 - missingFields.length / required.length));
  return { confidence, missingFields };
}

export async function extractDocument(params: {
  documentId: string;
  imageBytes: ArrayBuffer;
  contentType: string;
}): Promise<ExtractionOutcome> {
  const supabase = createSupabaseServiceRoleClient();

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, document_type, vertical")
    .eq("id", params.documentId)
    .maybeSingle();

  if (docError || !doc) {
    return { status: "failed", reason: docError?.message ?? "Document not found." };
  }

  const { data: template } = await supabase
    .from("extraction_templates")
    .select("id, prompt, output_schema, confidence_threshold, max_tokens")
    .eq("document_type", doc.document_type)
    .eq("vertical", doc.vertical)
    .maybeSingle();

  if (!template) {
    // Not an error — plenty of document_types (e.g. "other", "bank_statement")
    // don't have a registered template yet. See
    // ../../../document-intelligence/README.md's "Template Registry, Not
    // Template Ownership" section.
    return { status: "skipped", reason: `No extraction template registered for document_type "${doc.document_type}".` };
  }

  const { data: job, error: jobError } = await supabase
    .from("extraction_jobs")
    .insert({ document_id: doc.id, template_id: template.id, status: "processing" })
    .select("id")
    .single();

  if (jobError || !job) {
    return { status: "failed", reason: jobError?.message ?? "Could not create extraction job." };
  }

  await supabase.from("documents").update({ status: "extraction_queued" }).eq("id", doc.id);

  const instruction = `${template.prompt}\n\nRespond with ONLY a single JSON object matching this schema — no markdown code fences, no explanation before or after it: ${JSON.stringify(template.output_schema)}`;

  let rawText: string | null = null;
  let parsed: unknown = null;
  let ocrPageCount: number | null = null;

  try {
    if (VISION_COMPATIBLE_TYPES.has(params.contentType)) {
      rawText = await runVisionModel({ imageBytes: params.imageBytes, prompt: instruction, maxTokens: template.max_tokens });
    } else if (MARKDOWN_CONVERTIBLE_TYPES.has(params.contentType)) {
      const markdown = await convertToMarkdown({
        bytes: params.imageBytes,
        filename: `document.${extensionForContentType(params.contentType)}`,
        contentType: params.contentType,
      });

      // For a PDF specifically, Cloudflare's Markdown Conversion service
      // extracts an existing text layer (via the PDF's StructTree, or the
      // page text as-is) — it does NOT run OCR on a page that's just an
      // embedded image with no text layer at all. That's exactly what a
      // scanned/photographed document saved as .pdf looks like: real
      // pages, zero extractable text. A generated/digital PDF (e.g. Form
      // 26AS downloaded straight from the income tax portal) always has a
      // real text layer and converts fine; a scanned one comes back
      // near-empty instead.
      const looksLikeScannedPdf = params.contentType === "application/pdf" && markdown.replace(/\s+/g, "").length < 40;

      if (looksLikeScannedPdf) {
        // pdf-ocr.ts's fallback: pull the embedded page images back out and
        // run each through the vision model directly, then merge. This is
        // UNVERIFIED against a live deploy (see that file's header comment)
        // — any failure anywhere in this chain (unpdf parsing, the WASM PNG
        // re-encode, or a vision call itself) falls straight through to the
        // catch block below, same clear "not supported" failure as before
        // this existed. A bug here degrades to an honest error, never a
        // silent bad extraction.
        const pages = await extractScannedPdfPageImages(params.imageBytes);
        if (pages.length === 0) {
          throw new Error(
            "This PDF doesn't appear to contain a text layer, and no page images could be extracted from it either — it may be a scanned or photographed document in a format this pipeline can't read yet. Try uploading the original digital file if one is available."
          );
        }
        const pageResults: Record<string, unknown>[] = [];
        for (const page of pages) {
          const pageInstruction = `${instruction}\n\nThis is page ${page.pageNumber} of a ${pages.length}-page scanned document — some fields may only appear on other pages, that's expected.\n\nReminder: respond with ONLY the JSON object described above — no markdown, no page headers, no prose commentary.`;
          // Same per-template ceiling as the non-OCR paths, applied per
          // page rather than divided across pages — a single page's own
          // entries still need real headroom (e.g. one AIS page can carry
          // several information categories on its own), and
          // mergeExtractedPages() below is what combines the pages, not a
          // shared token budget between them.
          const pageRawText = await runVisionModel({ imageBytes: page.pngBytes, prompt: pageInstruction, maxTokens: template.max_tokens });
          const pageJsonText = stripToJsonObject(pageRawText);
          if (pageJsonText) {
            try {
              const pageParsed = JSON.parse(pageJsonText);
              if (pageParsed && typeof pageParsed === "object") {
                pageResults.push(pageParsed as Record<string, unknown>);
              }
            } catch {
              // One unparseable page shouldn't sink an otherwise-good
              // multi-page merge — skip it, same "best effort, not
              // all-or-nothing" posture as the rest of this fallback.
            }
          }
        }
        if (pageResults.length === 0) {
          throw new Error(
            "Extracted page images from this scanned PDF, but the vision model couldn't read structured data from any of them."
          );
        }
        parsed = mergeExtractedPages(pageResults);
        ocrPageCount = pages.length;
        rawText = JSON.stringify({ ocrMergedFrom: pages.length, pages: pageResults });
      } else {
        rawText = await runTextModel({
          prompt: `${instruction}\n\nDocument content (converted from the original file to text):\n${markdown}\n\nReminder: respond with ONLY the JSON object described above — no markdown code fences, no page headers or section titles, no prose commentary. Combine information from every page above into a single flat JSON object, not one section per page.`,
          maxTokens: template.max_tokens,
        });
      }
    } else {
      throw new Error(
        `Uploaded file type "${params.contentType}" isn't supported for extraction (expected a PDF or a JPEG/PNG/WEBP/GIF image).`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("extraction_jobs")
      .update({ status: "failed", raw_output: { error: message }, completed_at: new Date().toISOString() })
      .eq("id", job.id);
    await supabase.from("documents").update({ status: "extraction_failed" }).eq("id", doc.id);
    return { status: "failed", reason: message, jobId: job.id };
  }

  // The scanned-PDF OCR branch above already sets `parsed` directly (it's
  // a merge of several pages' JSON, not one bare model response) — only
  // run the single-response strip+parse for every other path.
  if (parsed === null && rawText !== null) {
    const jsonText = stripToJsonObject(rawText);
    if (jsonText) {
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        parsed = null;
      }
    }
  }

  if (parsed === null) {
    await supabase
      .from("extraction_jobs")
      .update({
        status: "failed",
        raw_output: { text: rawText },
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    await supabase.from("documents").update({ status: "extraction_failed" }).eq("id", doc.id);
    return { status: "failed", reason: "Model output wasn't valid JSON.", jobId: job.id };
  }

  const { confidence } = scoreExtraction(parsed, template.output_schema);

  // ocrPageCount is only set on the scanned-PDF OCR fallback path — surface
  // it (and whether MAX_OCR_PAGES cut the document short) in raw_output so
  // a truncated multi-page scan is visible to whoever reviews the job, not
  // silently dropped. Every other path leaves ocrPageCount null and this
  // adds nothing to raw_output.
  const ocrMeta =
    ocrPageCount !== null ? { ocrPageCount, ocrTruncated: ocrPageCount >= MAX_OCR_PAGES } : {};

  await supabase
    .from("extraction_jobs")
    .update({
      status: "completed",
      raw_output: { text: rawText, ...ocrMeta },
      interpretation: parsed as Record<string, unknown>,
      confidence,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await supabase.from("documents").update({ status: "extraction_completed" }).eq("id", doc.id);

  return { status: "completed", jobId: job.id, confidence };
}
