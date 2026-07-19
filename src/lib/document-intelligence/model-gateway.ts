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

import { getCloudflareContext } from "@opennextjs/cloudflare";

const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

export async function runVisionModel(params: { imageBytes: ArrayBuffer; prompt: string }): Promise<string> {
  const { env } = getCloudflareContext();
  const image = [...new Uint8Array(params.imageBytes)];

  const result = await env.AI.run(MODEL, {
    image,
    prompt: params.prompt,
  });

  // Workers AI text-generation-shaped models return { response: string };
  // defensive fallbacks in case this specific model's shape differs.
  if (typeof result === "string") return result;
  if (result && typeof result.response === "string") return result.response;
  if (result && typeof result.description === "string") return result.description;
  return JSON.stringify(result);
}
