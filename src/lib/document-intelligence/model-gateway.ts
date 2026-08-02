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
// Fallback providers (Phase 4 of ../../../document-intelligence/
// PERFORMANCE_STRATEGY.md, item 10) — runFallbackExtraction() below, tried
// by extract.ts only after the Workers AI path above has already thrown.
// Two providers rather than the one originally scoped ("build the OpenAI
// fallback"): OpenAI first, then Gemini as a second option if OpenAI is
// either unconfigured or itself fails — a burst Workers AI outage
// coinciding with an OpenAI outage is exactly the case a single fallback
// doesn't cover. Both optional (env.openAiApiKey()/geminiApiKey() return
// undefined if unset) — a deployment with neither configured behaves
// exactly as before this existed: a Workers AI failure is still a hard
// failure, just with a clearer "no fallback configured" reason attached
// instead of silently trying nothing.
//
// Deliberately NOT a byte-for-byte reimplementation of the Workers AI path
// above (markdown-conversion + per-page OCR fallback) — both OpenAI's and
// Gemini's chat/generateContent APIs accept a PDF or raster image directly
// as multimodal input and handle the page-reading themselves, so the
// fallback functions send the ORIGINAL uploaded file straight through,
// scoped to the content types both providers can read natively (PDF + the
// same image/* types VISION_COMPATIBLE_TYPES below already accepts — see
// isFallbackSupportedContentType()). The other MARKDOWN_CONVERTIBLE_TYPES
// in extract.ts (csv/html/docx/xlsx) have no equivalent native-document
// path on either provider without real testing to confirm one, so a
// failure on those content types just isn't retried — falls straight
// through to today's existing failure, not a silent gap.
//
// UNVERIFIED AGAINST A LIVE DEPLOY, same posture as pdf-ocr.ts: built and
// typechecked without live OPENAI_API_KEY/GEMINI_API_KEY credentials or
// network access to either provider from this sandbox. Both request shapes
// are built from each provider's own current API documentation (OpenAI
// Chat Completions' `file`/`image_url` content parts, Gemini's
// generateContent `inlineData` part), but neither has actually round-
// tripped a real document through a live API call. Test with a real key
// before trusting this in production — a bug here degrades to the ORIGINAL
// Workers AI error still winning (see extract.ts's runExtractionWithFallback()),
// never a crash or a silently wrong extraction.
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
import { env } from "@/config/env";

const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

// Fallback only for a caller that doesn't pass one at all — every real
// call site (extract.ts) always does, reading it off the template row, so
// this only matters for some future caller that forgets. Matches
// 0023_extraction_template_max_tokens.sql's own column default, not
// Workers AI's much lower built-in one (256) — the whole point of this
// parameter existing is to not fall back to that.
const FALLBACK_MAX_TOKENS = 2048;

// Root-caused fix for the recurring stuck-at-"processing" bug (see
// ../../../../document-intelligence/PERFORMANCE_STRATEGY.md's Phase 1) —
// reproduced 4 times in one evening (bank_statement, three individual
// document types, capital_gains_statement), all sharing one trait: an
// array-heavy template with max_tokens bumped to 4096. Confirmed via
// siringetbase.extraction_jobs each time that extractDocument() (extract.ts)
// HAD already reached its model-calling try block — the job row existed
// with status='processing' and documents.status had already flipped to
// 'extraction_queued' — so the hang is not "the request to platform-core
// never arrived" (that theory drove an earlier, unsuccessful fix attempt in
// cafocus/app's retry.ts/trigger.ts). It's that `env.AI.run()`/
// `env.AI.toMarkdown()` below never settled — neither resolved nor
// rejected — leaving extractDocument()'s single `await` parked forever, so
// it never reaches its own catch block or writes a terminal status.
// withTimeout() bounds that specific await: past MODEL_CALL_TIMEOUT_MS the
// wrapped promise rejects with a clear message, which flows straight into
// extract.ts's existing catch block (already writes extraction_jobs
// status='failed' + documents.status='extraction_failed' with a real
// reason) — turning a silent, permanent hang into a normal, visible,
// retryable failure. The underlying env.AI call itself is NOT cancelled
// (Workers AI's binding gives no abort mechanism) and may still resolve
// long after this — that dangling promise is harmless since nothing holds
// a reference to it once withTimeout() has already settled the race.
const MODEL_CALL_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} did not respond within ${ms / 1000}s — Workers AI call never settled.`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function runVisionModel(params: { imageBytes: ArrayBuffer; prompt: string; maxTokens?: number }): Promise<string> {
  const { env } = getCloudflareContext();
  const image = [...new Uint8Array(params.imageBytes)];

  const result = await withTimeout(
    env.AI.run(MODEL, {
      image,
      prompt: params.prompt,
      max_tokens: params.maxTokens ?? FALLBACK_MAX_TOKENS,
    }),
    MODEL_CALL_TIMEOUT_MS,
    "Vision model call"
  );

  return extractTextFromModelResult(result);
}

// Text-only call to the same model — no `image` param at all. Used once a
// document's actual text content has already been pulled out via
// convertToMarkdown() below, so the model just has to follow the
// extraction instruction against plain text, the same task it already does
// for a photographed document, just without needing to read pixels itself.
export async function runTextModel(params: { prompt: string; maxTokens?: number }): Promise<string> {
  const { env } = getCloudflareContext();
  const result = await withTimeout(
    env.AI.run(MODEL, { prompt: params.prompt, max_tokens: params.maxTokens ?? FALLBACK_MAX_TOKENS }),
    MODEL_CALL_TIMEOUT_MS,
    "Text model call"
  );
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
  // This call was the actual gap in the first pass of this fix: withTimeout()
  // was added to runVisionModel()/runTextModel() above but NOT here — and a
  // live verification upload right after that deploy (a plain
  // text-layer PDF, which extract.ts routes through convertToMarkdown() +
  // runTextModel(), not the vision/OCR path) sat stuck past the 90s+120s
  // window with no revert, proving this specific call — Workers AI's
  // Markdown Conversion service, still "Beta" per Cloudflare's own docs —
  // is at least as likely a hang point as the two calls already wrapped.
  const result = await withTimeout(
    env.AI.toMarkdown({
      name: params.filename,
      blob: new Blob([params.bytes], { type: params.contentType }),
    }),
    MODEL_CALL_TIMEOUT_MS,
    "Markdown conversion call"
  );
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

// --- Fallback providers (Phase 4) --------------------------------------
// See this file's header comment for the full design/scope reasoning.

// Same five raster types VISION_COMPATIBLE_TYPES accepts in extract.ts,
// plus application/pdf (which neither provider needs Workers-AI-style
// markdown-conversion for — both read a PDF natively). Not the full
// MARKDOWN_CONVERTIBLE_TYPES set — see header comment for why csv/html/
// docx/xlsx aren't included here.
const FALLBACK_SUPPORTED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function isFallbackSupportedContentType(contentType: string): boolean {
  return FALLBACK_SUPPORTED_TYPES.has(contentType);
}

export interface FallbackExtractionParams {
  bytes: ArrayBuffer;
  contentType: string;
  prompt: string;
  maxTokens: number;
}

// btoa() only accepts a binary string, not raw bytes — chunked to avoid
// blowing the call stack via String.fromCharCode(...hugeArray) on a
// multi-MB file (a real GST invoice PDF or a phone-camera photo can
// comfortably exceed the ~65k-argument ceiling most JS engines impose on
// spread/apply). Same chunking concern pdf-ocr.ts's base64ToBytes()
// sidesteps in the opposite direction (base64 -> bytes) by iterating
// byte-by-byte instead of chunking; chunking is the cheaper direction here
// since fromCharCode accepts many args per call, just not unbounded many.
function bytesToBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// OpenAI Chat Completions, vision-capable model. gpt-4o-mini over gpt-4o —
// this is a fallback path (Workers AI already failed), not the primary
// extraction quality bar, so cost/latency wins over the marginal accuracy
// gain of the larger model; revisit if fallback accuracy turns out to
// matter more than that trade-off suggests. PDFs go through as a `file`
// content part (file_data as a base64 data URI); raster images as
// `image_url` the same way. Both are read natively by the model — no
// separate OCR/markdown-conversion step needed, unlike the Workers AI path.
const OPENAI_MODEL = "gpt-4o-mini";

export async function runOpenAiExtraction(params: FallbackExtractionParams): Promise<string> {
  const apiKey = env.openAiApiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const base64 = bytesToBase64(params.bytes);
  const contentPart =
    params.contentType === "application/pdf"
      ? { type: "file", file: { filename: "document.pdf", file_data: `data:application/pdf;base64,${base64}` } }
      : { type: "image_url", image_url: { url: `data:${params.contentType};base64,${base64}` } };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: params.maxTokens,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: params.prompt },
            contentPart,
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`OpenAI returned HTTP ${res.status}: ${errBody.slice(0, 500)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI response had no message content.");
  return text;
}

// Gemini generateContent — PDFs and images both go through as an
// `inlineData` part (base64 + mimeType), Google's documented native-
// document path for both content types alike, so unlike OpenAI's split
// content-part shape above there's no PDF-vs-image branch needed here.
const GEMINI_MODEL = "gemini-1.5-flash";

export async function runGeminiExtraction(params: FallbackExtractionParams): Promise<string> {
  const apiKey = env.geminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const base64 = bytesToBase64(params.bytes);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: params.prompt }, { inlineData: { mimeType: params.contentType, data: base64 } }],
          },
        ],
        generationConfig: { maxOutputTokens: params.maxTokens },
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Gemini returned HTTP ${res.status}: ${errBody.slice(0, 500)}`);
  }

  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini response had no content parts.");
  return text;
}

export type FallbackProvider = "openai" | "gemini";

export interface FallbackExtractionResult {
  rawText: string;
  provider: FallbackProvider;
}

// Tried in order: OpenAI, then Gemini. Either or both may be unconfigured
// (that's not an error here — see FallbackExtractionParams's header
// comment) or may themselves fail (a bad key, the provider's own outage,
// content the model refuses). Only once every configured option is
// exhausted does this throw — extract.ts's caller then re-surfaces the
// ORIGINAL Workers AI error (not this function's), so whoever reviews a
// failed job sees the real root cause, not "and then two fallbacks also
// failed" noise on top of it. See extract.ts's runExtractionWithFallback().
export async function runFallbackExtraction(params: FallbackExtractionParams): Promise<FallbackExtractionResult> {
  const attempts: string[] = [];

  if (env.openAiApiKey()) {
    try {
      const rawText = await runOpenAiExtraction(params);
      return { rawText, provider: "openai" };
    } catch (err) {
      attempts.push(`OpenAI: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (env.geminiApiKey()) {
    try {
      const rawText = await runGeminiExtraction(params);
      return { rawText, provider: "gemini" };
    } catch (err) {
      attempts.push(`Gemini: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(
    attempts.length > 0
      ? `All configured fallback providers failed — ${attempts.join("; ")}`
      : "No fallback provider is configured (OPENAI_API_KEY and GEMINI_API_KEY both unset)."
  );
}
