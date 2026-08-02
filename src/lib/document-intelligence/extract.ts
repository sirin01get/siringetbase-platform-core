import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  runVisionModel,
  runTextModel,
  convertToMarkdown,
  runFallbackExtraction,
  isFallbackSupportedContentType,
  type FallbackProvider,
} from "./model-gateway";
import { extractScannedPdfPageImages, mergeExtractedPages, MAX_OCR_PAGES } from "./pdf-ocr";
import { validateFields, type FieldValidationIssue } from "./field-validation";
import { writeExtractionCompletedEvent } from "./events";

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
): { confidence: number; missingFields: string[]; fieldIssues: FieldValidationIssue[] } {
  const required = Array.isArray(outputSchema.required) ? (outputSchema.required as string[]) : [];
  if (!parsed || typeof parsed !== "object") {
    return { confidence: 0, missingFields: required, fieldIssues: [] };
  }
  const obj = parsed as Record<string, unknown>;
  const missingFields = required.filter((key) => obj[key] === undefined || obj[key] === null || obj[key] === "");
  // Heuristic bands: all required fields present -> 0.75; some missing ->
  // scaled down proportionally, floor 0.2 so a mostly-complete extraction
  // doesn't read as a total failure.
  const presenceConfidence =
    required.length === 0
      ? 0.6
      : Math.max(0.2, 0.75 * (1 - missingFields.length / required.length));

  // Phase 2 of ../../../document-intelligence/PERFORMANCE_STRATEGY.md:
  // field-level format/checksum validation (./field-validation.ts) layered
  // ON TOP of the presence check above, not replacing it — presence alone
  // can't tell a correct seller_gstin from a present-but-wrong one (one
  // misread character, still non-empty). Each present-but-invalid field
  // knocks a fixed amount off the presence score, capped so a single bad
  // field can't sink an otherwise-complete extraction as hard as being
  // mostly empty does, and never below the floor below the ordinary
  // missing-field floor — a document with all required fields present but
  // one garbled GSTIN is still more useful to a reviewer than one that's
  // half-empty.
  const fieldIssues = validateFields(parsed, outputSchema);
  const validationPenalty = Math.min(0.4, fieldIssues.length * 0.15);
  const confidence = Math.max(0.1, presenceConfidence - validationPenalty);

  return { confidence, missingFields, fieldIssues };
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
  // Phase 1 item 3 (structured per-attempt logging) — which provider
  // actually produced rawText. Stays "workers_ai" unless the fallback
  // chain below (Phase 4, model-gateway.ts's runFallbackExtraction()) is
  // the one that succeeded.
  let modelProvider: "workers_ai" | FallbackProvider = "workers_ai";
  const startedAt = Date.now();

  // TypeScript doesn't carry the `!job`/`!doc`/`!template` null-narrowing
  // above into nested function bodies (writeExtractionFailure and
  // runPrimaryExtraction below both close over these) — it can't prove a
  // closure won't run after some other reassignment, so it falls back to
  // each variable's declared (nullable) type inside them. These are
  // plain, never-reassigned locals captured right after the narrowing
  // checks instead, so every closure below sees a definitely-non-null
  // value without repeating the null check.
  const jobId = job.id;
  const docId = doc.id;
  const templateMaxTokens = template.max_tokens;

  // Small helper so every failure exit writes the same shape of
  // extraction_jobs/documents update — three call sites need this below
  // (the primary+fallback catch, the invalid-JSON case), previously
  // duplicated inline.
  async function writeExtractionFailure(reason: string, rawOutput: Record<string, unknown>): Promise<ExtractionOutcome> {
    await supabase
      .from("extraction_jobs")
      .update({
        status: "failed",
        raw_output: rawOutput,
        model_provider: modelProvider,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    await supabase.from("documents").update({ status: "extraction_failed" }).eq("id", docId);
    return { status: "failed", reason, jobId };
  }

  // The original Workers-AI-only extraction attempt — pulled into its own
  // function so it can be wrapped by the Phase 4 fallback chain below
  // without duplicating this whole branch. Throws on any failure, same as
  // before this was extracted.
  async function runPrimaryExtraction(): Promise<void> {
    // Phase 4 item 11 — basic circuit-breaker / backpressure awareness.
    // Checked FIRST, before spending up to MODEL_CALL_TIMEOUT_MS (90s)
    // waiting on a provider that's very likely about to fail anyway: if
    // Workers AI's own recent attempts have mostly been failing, skip
    // straight to a fallback provider instead of queueing behind the same
    // outage/rate-limit every other in-flight attempt is presumably also
    // hitting. Throwing here (rather than special-casing the caller) routes
    // through the exact same fallback-chain catch block below as any other
    // primary-path failure — no separate code path to keep in sync.
    if (isFallbackSupportedContentType(params.contentType) && (await isWorkersAiCircuitOpen(supabase))) {
      throw new Error(
        `Workers AI circuit breaker open — ${Math.round(CIRCUIT_BREAKER_FAILURE_THRESHOLD * 100)}%+ of its last ${CIRCUIT_BREAKER_WINDOW} attempts failed; skipping straight to a fallback provider instead of waiting out a likely-doomed call.`
      );
    }
    if (VISION_COMPATIBLE_TYPES.has(params.contentType)) {
      rawText = await runVisionModel({ imageBytes: params.imageBytes, prompt: instruction, maxTokens: templateMaxTokens });
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
        // catch below, same clear "not supported" failure as before this
        // existed. A bug here degrades to an honest error, never a silent
        // bad extraction.
        const pages = await extractScannedPdfPageImages(params.imageBytes);
        if (pages.length === 0) {
          throw new Error(
            "This PDF doesn't appear to contain a text layer, and no page images could be extracted from it either — it may be a scanned or photographed document in a format this pipeline can't read yet. Try uploading the original digital file if one is available."
          );
        }
        // Phase 3 item 8: pages run with bounded CONCURRENCY rather than
        // one-at-a-time — a 5-page scanned document used to pay for 5
        // sequential vision-model round trips; OCR_PAGE_CONCURRENCY caps
        // how many run at once so this doesn't just hammer Workers AI
        // unbounded (see mapWithConcurrency()'s own comment). Ordering is
        // preserved (results[i] always corresponds to pages[i]) even
        // though pages don't necessarily finish in order, which matters
        // for mergeExtractedPages()' "first non-empty value wins" scalar
        // handling below — same merge semantics as the old sequential loop.
        const pageParsedResults = await mapWithConcurrency(pages, OCR_PAGE_CONCURRENCY, async (page) => {
          const pageInstruction = `${instruction}\n\nThis is page ${page.pageNumber} of a ${pages.length}-page scanned document — some fields may only appear on other pages, that's expected.\n\nReminder: respond with ONLY the JSON object described above — no markdown, no page headers, no prose commentary.`;
          // Same per-template ceiling as the non-OCR paths, applied per
          // page rather than divided across pages — a single page's own
          // entries still need real headroom (e.g. one AIS page can carry
          // several information categories on its own), and
          // mergeExtractedPages() below is what combines the pages, not a
          // shared token budget between them.
          const pageRawText = await runVisionModel({ imageBytes: page.pngBytes, prompt: pageInstruction, maxTokens: templateMaxTokens });
          const pageJsonText = stripToJsonObject(pageRawText);
          if (pageJsonText) {
            try {
              const pageParsed = JSON.parse(pageJsonText);
              if (pageParsed && typeof pageParsed === "object") return pageParsed as Record<string, unknown>;
            } catch {
              // One unparseable page shouldn't sink an otherwise-good
              // multi-page merge — skip it, same "best effort, not
              // all-or-nothing" posture as the rest of this fallback.
            }
          }
          return null;
        });
        const pageResults = pageParsedResults.filter((p): p is Record<string, unknown> => p !== null);
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
          maxTokens: templateMaxTokens,
        });
      }
    } else {
      throw new Error(
        `Uploaded file type "${params.contentType}" isn't supported for extraction (expected a PDF or a JPEG/PNG/WEBP/GIF image).`
      );
    }
  }

  try {
    await runPrimaryExtraction();
  } catch (primaryErr) {
    const primaryMessage = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);

    // Phase 4 (../../../document-intelligence/PERFORMANCE_STRATEGY.md item
    // 10): only attempt OpenAI/Gemini for content types either provider can
    // actually read natively — see model-gateway.ts's
    // isFallbackSupportedContentType() for the full reasoning (PDF + raster
    // images only, not csv/html/docx/xlsx). Everything else falls straight
    // through to the original failure below, unchanged from before this
    // existed.
    if (!isFallbackSupportedContentType(params.contentType)) {
      return await writeExtractionFailure(primaryMessage, { error: primaryMessage });
    }

    try {
      const fallback = await runFallbackExtraction({
        bytes: params.imageBytes,
        contentType: params.contentType,
        prompt: instruction,
        maxTokens: templateMaxTokens,
      });
      rawText = fallback.rawText;
      modelProvider = fallback.provider;
      // parsed stays null here — falls into the same strip+parse block
      // below every other single-response path (runVisionModel/
      // runTextModel) already goes through, so a fallback response gets
      // identical JSON-cleanup handling to a Workers AI one.
    } catch (fallbackErr) {
      // Every configured fallback (or none at all) failed. Surface the
      // ORIGINAL Workers AI error, not the fallback error — that's the
      // real root cause a reviewer needs, per model-gateway.ts's own
      // reasoning; the fallback attempt and its own failure reason still
      // ride along in raw_output for anyone who wants the detail, just not
      // as the headline reason.
      const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      return await writeExtractionFailure(primaryMessage, {
        error: primaryMessage,
        fallbackAttempted: true,
        fallbackError: fallbackMessage,
      });
    }
  }

  // The scanned-PDF OCR branch above already sets `parsed` directly (it's
  // a merge of several pages' JSON, not one bare model response) — only
  // run the single-response strip+parse for every other path (Workers AI
  // vision/text, or a Phase 4 fallback response).
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
    return await writeExtractionFailure("Model output wasn't valid JSON.", { text: rawText });
  }

  const { confidence, fieldIssues } = scoreExtraction(parsed, template.output_schema);

  // ocrPageCount is only set on the scanned-PDF OCR fallback path — surface
  // it (and whether MAX_OCR_PAGES cut the document short) in raw_output so
  // a truncated multi-page scan is visible to whoever reviews the job, not
  // silently dropped. Every other path leaves ocrPageCount null and this
  // adds nothing to raw_output.
  const ocrMeta =
    ocrPageCount !== null ? { ocrPageCount, ocrTruncated: ocrPageCount >= MAX_OCR_PAGES } : {};

  // fieldValidationIssues rides along in the same free-form raw_output jsonb
  // column rather than a new extraction_jobs column — no migration needed,
  // and it's already the established place a reviewer looks for "why did
  // this score what it scored" detail (see ocrMeta above). Omitted entirely
  // when empty rather than stored as [], so an unaffected job's raw_output
  // shape doesn't change from before this feature existed.
  const fieldValidationMeta = fieldIssues.length > 0 ? { fieldValidationIssues: fieldIssues } : {};

  // Phase 1 item 3: durationMs alongside the existing created_at/completed_at
  // pair, rather than replacing them — a per-attempt wall-clock figure that
  // doesn't require a reader to subtract two timestamps themselves, and
  // (unlike created_at) starts from when this specific attempt's model call
  // began, not when the job row was first inserted.
  const durationMs = Date.now() - startedAt;

  await supabase
    .from("extraction_jobs")
    .update({
      status: "completed",
      raw_output: { text: rawText, durationMs, ...ocrMeta, ...fieldValidationMeta },
      interpretation: parsed as Record<string, unknown>,
      confidence,
      model_provider: modelProvider,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await supabase.from("documents").update({ status: "extraction_completed" }).eq("id", doc.id);

  // Phase 5 item 12 — the emit(extraction.completed) step
  // ../../../document-intelligence/README.md documents as designed but not
  // built. Fired here, after both terminal writes above have already
  // succeeded — see writeExtractionCompletedEvent()'s own comment for why
  // this is fire-and-forget/best-effort rather than something this
  // function awaits failure on.
  await writeExtractionCompletedEvent({
    jobId: job.id,
    documentId: doc.id,
    vertical: doc.vertical,
    documentType: doc.document_type,
    confidence,
    modelProvider,
  });

  return { status: "completed", jobId: job.id, confidence };
}

// Phase 4 item 11 — basic circuit-breaker / backpressure awareness. Looks
// at the most recent CIRCUIT_BREAKER_WINDOW extraction_jobs rows that were
// primarily attempted via Workers AI (model_provider defaults to
// 'workers_ai' and only changes if a fallback provider actually produced
// the response — see extractDocument()'s writeExtractionFailure()/the
// completed-status update). If CIRCUIT_BREAKER_FAILURE_THRESHOLD or more of
// them ended status='failed', treat Workers AI as temporarily unavailable
// for THIS attempt rather than spending up to MODEL_CALL_TIMEOUT_MS finding
// that out again firsthand. Deliberately approximate, not a precise
// "Workers AI is down" signal — a status='failed' row can also mean a
// genuinely malformed document or an unsupported file type, not just a
// provider outage/rate-limit. The roadmap's own item 11 framing ("a
// rate-limit response from Workers AI is indistinguishable from any other
// failure today") accepts exactly this imprecision as the starting point;
// a more precise signal (e.g. classifying WHICH failures were actually
// rate-limit/5xx responses vs. content problems) is a reasonable follow-up,
// not required for "basic" backpressure awareness. Requires a FULL window
// of data before ever opening the circuit (fewer than
// CIRCUIT_BREAKER_WINDOW historical rows = not enough signal yet) — a
// fresh deployment or a document type that's barely been used shouldn't
// trip this off one or two unlucky failures.
const CIRCUIT_BREAKER_WINDOW = 10;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 0.6;

async function isWorkersAiCircuitOpen(supabase: ReturnType<typeof createSupabaseServiceRoleClient>): Promise<boolean> {
  const { data, error } = await supabase
    .from("extraction_jobs")
    .select("status")
    .eq("model_provider", "workers_ai")
    .in("status", ["completed", "failed"])
    .order("created_at", { ascending: false })
    .limit(CIRCUIT_BREAKER_WINDOW);

  // Fails OPEN in the literal sense — any error reading this history (a
  // transient DB blip, a schema mismatch) means "don't know," which should
  // never block or reroute a real extraction attempt over a check that's
  // purely an optimization, not a correctness requirement.
  if (error || !data || data.length < CIRCUIT_BREAKER_WINDOW) return false;

  const failures = data.filter((row) => (row as { status: string }).status === "failed").length;
  return failures / data.length >= CIRCUIT_BREAKER_FAILURE_THRESHOLD;
}

// Phase 3 item 8 — bounded-concurrency page mapper for the scanned-PDF OCR
// fallback above. 3 is a deliberately conservative starting point (not
// unbounded Promise.all): each page is its own vision-model round trip
// against a shared Workers AI account-level rate limit, and there's no live
// traffic data yet on where that ceiling actually sits (Phase 3 item 9's
// benchmark tooling is the intended way to get that data). Safe to raise
// once real scanned-document throughput is observed. Preserves result
// ORDER (results[i] matches items[i]) regardless of which worker finishes
// which item first — callers that care about page order (mergeExtractedPages()'
// scalar "first non-empty wins" semantics) depend on this.
const OCR_PAGE_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) return;
      results[i] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
