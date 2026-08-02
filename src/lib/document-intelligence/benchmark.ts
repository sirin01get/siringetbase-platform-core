// @ts-nocheck
//
// Phase 3 item 9 of ../../../document-intelligence/PERFORMANCE_STRATEGY.md:
// "benchmark tooling for alternate vision models." Same @ts-nocheck
// reasoning as ./model-gateway.ts's header comment — getCloudflareContext()
// pulls in @cloudflare/workers-types globals that collide with this
// project's "dom" lib, so type-checking is suppressed in this file only;
// runModelBenchmark()'s own signature below is what callers see.
//
// This is deliberately NOT wired into the real extraction pipeline
// (extract.ts still only ever calls the one MODEL constant in
// model-gateway.ts) — it's a side, admin-triggered tool for comparing
// candidate Workers AI vision models against the SAME uploaded document +
// prompt, side by side, before anyone commits to changing that constant.
// Swapping the pipeline's actual model based on this tool's output is a
// separate, deliberate step a human takes afterward (edit MODEL in
// model-gateway.ts) — same "audit, not auto-apply" posture as
// ./metrics.ts's max_tokens audit.
//
// UNVERIFIED AGAINST A LIVE DEPLOY, same posture as pdf-ocr.ts and
// model-gateway.ts's fallback providers: built and typechecked without a
// real Workers AI account to confirm which alternate vision-capable model
// IDs are actually available and licensed on it, or their real relative
// latency/quality. Model IDs are supplied by the caller (the admin UI's
// text input), not hardcoded here — see
// https://developers.cloudflare.com/workers-ai/models/ (filter by "Vision")
// for the current catalog, since Cloudflare adds/deprecates models on their
// own schedule and a hardcoded list here would silently go stale. Each
// candidate model that isn't licensed on the account yet will surface a
// clear per-model error in the results (typically a license/terms message,
// same one documented in model-gateway.ts's header comment for the
// default model) rather than failing the whole benchmark run.

import { getCloudflareContext } from "@opennextjs/cloudflare";

// Same ceiling extract.ts's own model calls use — a benchmark run against a
// genuinely broken/unlicensed model shouldn't hang the whole comparison
// past what a real extraction would ever wait.
const BENCHMARK_CALL_TIMEOUT_MS = 90_000;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not respond within ${ms / 1000}s.`)), ms);
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

function extractTextFromModelResult(result) {
  if (typeof result === "string") return result;
  if (result && typeof result.response === "string") return result.response;
  if (result && typeof result.description === "string") return result.description;
  return JSON.stringify(result);
}

// Deliberately minimal — not extract.ts's real stripToJsonObject() (fenced
// code blocks, last-candidate-wins, etc.). This tool only needs a rough
// "did this model even produce something JSON.parse-able" signal to compare
// candidates at a glance; a model worth pursuing further gets a real trial
// through the actual pipeline (a registered extraction_templates row),
// which DOES use the real parser.
function looksLikeParseableJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return false;
  try {
    JSON.parse(text.slice(start, end + 1));
    return true;
  } catch {
    return false;
  }
}

export interface BenchmarkResultRow {
  model: string;
  ok: boolean;
  latencyMs: number;
  outputChars: number | null;
  looksLikeValidJson: boolean;
  outputPreview: string | null;
  error: string | null;
}

export async function runModelBenchmark(params: {
  imageBytes: ArrayBuffer;
  prompt: string;
  maxTokens: number;
  models: string[];
}): Promise<BenchmarkResultRow[]> {
  const { env } = getCloudflareContext();
  const image = [...new Uint8Array(params.imageBytes)];

  const results: BenchmarkResultRow[] = [];
  // Sequential, not concurrent — this is a manual, occasional admin tool,
  // not a hot path (unlike extract.ts's mapWithConcurrency() OCR loop,
  // which exists specifically to speed up a real user-facing wait). Running
  // one model at a time also keeps each one's latency reading honest —
  // Workers AI's own per-account concurrency limits would otherwise distort
  // a candidate's numbers depending on how many other calls it happened to
  // race against.
  for (const model of params.models) {
    const startedAt = Date.now();
    try {
      const result = await withTimeout(
        env.AI.run(model, { image, prompt: params.prompt, max_tokens: params.maxTokens }),
        BENCHMARK_CALL_TIMEOUT_MS,
        `Benchmark call to ${model}`
      );
      const text = extractTextFromModelResult(result);
      results.push({
        model,
        ok: true,
        latencyMs: Date.now() - startedAt,
        outputChars: text.length,
        looksLikeValidJson: looksLikeParseableJson(text),
        outputPreview: text.slice(0, 400),
        error: null,
      });
    } catch (err) {
      results.push({
        model,
        ok: false,
        latencyMs: Date.now() - startedAt,
        outputChars: null,
        looksLikeValidJson: false,
        outputPreview: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
