// @ts-nocheck
//
// Workers AI access — isolated behind one explicitly-typed function, same
// reasoning and pattern as cafocus/app's src/lib/r2/ca-documents.ts:
// @opennextjs/cloudflare's getCloudflareContext() ships types that pull in
// @cloudflare/workers-types globals, which collide with this project's
// "dom" lib. `@ts-nocheck` suppresses type-checking inside this file only —
// runVisionModel()'s own signature below is what the rest of the app sees.
//
// Model: @cf/meta/llama-3.2-11b-vision-instruct — Cloudflare Workers AI's
// vision-instruction-tuned model, confirmed current as of 2026-07-19 (see
// https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/).
// Image input is a plain byte array (`[...new Uint8Array(bytes)]`), not
// base64 — confirmed against Cloudflare's own tutorial example.
//
// One-time activation required before this responds: Meta's license for
// this model must be accepted once per Cloudflare account by sending a
// single request with `{"prompt":"agree"}` — see this repo's
// ../../../document-intelligence/README.md and README.md's "Document
// Intelligence" section for the exact command. Every call before that
// returns an error about the license/terms, not a code bug.
//
// No fallback provider wired yet (../../../document-intelligence/README.md
// describes "Workers AI default, OpenAI fallback" — only the default half
// is built; OpenAI fallback is flagged, not implemented, since it would
// need a new external API key this build doesn't have configured anywhere).
//
// runVisionModel()/runTextModel() take `maxTokens` as a plain named
// parameter, not nested inside a Workers-AI-shaped options object — root-
// caused fix for a real bug (0023_extraction_template_max_tokens.sql):
// neither function used to set it at all, so every call silently used
// Workers AI's own default of 256 output tokens, which truncated a real
// AIS extraction (its output_schema has the one genuinely open-ended
// array among this pipeline's templates) mid-response, producing text
// that failed even the cleanup pass in extract.ts's stripToJsonObject().
// Deliberately named/shaped so a future OpenAI (or other) adapter can
// accept the exact same `maxTokens` param and mean the same thing — the
// caller (extract.ts) shouldn't have to know or care which provider is
// actually running underneath. The one thing this does NOT make portable:
// a token COUNT is tokenizer-specific, so a value tuned against this
// model isn't an exact match for another provider's tokenizer — still the
// right order of magnitude, just not a byte-for-byte guarantee. See
// 0023_extraction_template_max_tokens.sql's comment for the full
// reasoning on why this lives on extraction_templates per-row rather than
// as a single pipeline-wide constant.
//
// runVisionModel() below is for genuine raster images only — every
// document_type this pipeline actually targets today (Form 16/16A/26AS,
// AIS, GST invoices — see supabase/migrations/0021_extraction_templates_seed.sql)
// is realistically uploaded as a PDF, not a photo, and a PDF's raw bytes
// are NOT a valid image: Workers AI rejects them with error 3030
// ("Provided image is not compatible or malformed") rather than trying to
// interpret them. convertToMarkdown() + runTextModel() below is the path
// for that — see extract.ts's content-type branch for which one a given
// upload actually takes.

import { getCloudflareContext } from "@opennextjs/cloudflare";

const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

// Fallback only for a caller that doesn't pass one at all — every real
// call site (extract.ts) always does, reading it off the template row, so
// this only matters for some future caller that forgets. Matches
// 0023_extraction_template_max_tokens.sql's own column default, not
// Workers AI's much lower built-in one (256) — the whole point of this
// parameter existing is to not fall back to that.
const FALLBACK_MAX_TOKENS = 2048;

export async function runVisionModel(params: { imageBytes: ArrayBuffer; prompt: string; maxTokens?: number }): Promise<string> {
  const { env } = getCloudflareContext();
  const image = [...new Uint8Array(params.imageBytes)];

  const result = await env.AI.run(MODEL, {
    image,
    prompt: params.prompt,
    max_tokens: params.maxTokens ?? FALLBACK_MAX_TOKENS,
  });

  return extractTextFromModelResult(result);
}

// Text-only call to the same model — no `image` param at all. Used once a
// document's actual text content has already been pulled out via
// convertToMarkdown() below, so the model just has to follow the
// extraction instruction against plain text, the same task it already does
// for a photographed document, just without needing to read pixels itself.
export async function runTextModel(params: { prompt: string; maxTokens?: number }): Promise<string> {
  const { env } = getCloudflareContext();
  const result = await env.AI.run(MODEL, { prompt: params.prompt, max_tokens: params.maxTokens ?? FALLBACK_MAX_TOKENS });
  return extractTextFromModelResult(result);
}

function extractTextFromModelResult(result: unknown): string {
  // Workers AI text-generation-shaped models return { response: string };
  // defensive fallbacks in case this specific model's shape differs.
  if (typeof result === "string") return result;
  if (result && typeof (result as { response?: unknown }).response === "string") {
    return (result as { response: string }).response;
  }
  if (result && typeof (result as { description?: unknown }).description === "string") {
    return (result as { description: string }).description;
  }
  return JSON.stringify(result);
}

// Workers AI's Markdown Conversion service (Beta) — converts a document
// (PDF, image, HTML, Office doc, CSV, etc.) to plain-text Markdown. This is
// the actual fix for error 3030: a PDF was never a valid `image` param for
// runVisionModel() above, but it IS a supported input here. See
// https://developers.cloudflare.com/workers-ai/features/markdown-conversion/supported-formats/
// for the full supported-format list — extract.ts's SUPPORTED_MARKDOWN_TYPES
// mirrors it for the subset this pipeline actually needs to accept.
export async function convertToMarkdown(params: {
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
}): Promise<string> {
  const { env } = getCloudflareContext();
  const result = await env.AI.toMarkdown({
    name: params.filename,
    blob: new Blob([params.bytes], { type: params.contentType }),
  });
  // The binding returns a single ConversionResult when given a single
  // document (not wrapped in an array) — see the "Converting files"
  // example in Cloudflare's docs, which passes an array and gets an array
  // back. Handle both shapes defensively rather than assuming which one a
  // single-document call returns.
  const single = Array.isArray(result) ? result[0] : result;
  if (!single || single.format === "error") {
    throw new Error(single?.error ?? "Markdown conversion returned no content and no error message.");
  }
  return single.data ?? "";
}
