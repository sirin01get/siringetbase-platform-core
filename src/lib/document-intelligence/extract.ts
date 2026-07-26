import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { runVisionModel, runTextModel, convertToMarkdown } from "./model-gateway";

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

function stripToJsonObject(text: string): string | null {
  // Model output is a chat-style response, not guaranteed to be bare JSON —
  // strip markdown code fences if present, then take the substring between
  // the first '{' and the last '}'. Good enough for a single top-level JSON
  // object, which is all every template here asks for.
  const withoutFences = text.replace(/```json/gi, "").replace(/```/g, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return withoutFences.slice(start, end + 1);
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
    .select("id, prompt, output_schema, confidence_threshold")
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

  let rawText: string;
  try {
    if (VISION_COMPATIBLE_TYPES.has(params.contentType)) {
      rawText = await runVisionModel({ imageBytes: params.imageBytes, prompt: instruction });
    } else if (MARKDOWN_CONVERTIBLE_TYPES.has(params.contentType)) {
      const markdown = await convertToMarkdown({
        bytes: params.imageBytes,
        filename: `document.${extensionForContentType(params.contentType)}`,
        contentType: params.contentType,
      });
      rawText = await runTextModel({
        prompt: `${instruction}\n\nDocument content (converted from the original file to text):\n${markdown}`,
      });
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

  const jsonText = stripToJsonObject(rawText);
  let parsed: unknown = null;
  if (jsonText) {
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      parsed = null;
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

  await supabase
    .from("extraction_jobs")
    .update({
      status: "completed",
      raw_output: { text: rawText },
      interpretation: parsed as Record<string, unknown>,
      confidence,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await supabase.from("documents").update({ status: "extraction_completed" }).eq("id", doc.id);

  return { status: "completed", jobId: job.id, confidence };
}
