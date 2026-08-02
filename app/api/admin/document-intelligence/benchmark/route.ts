import { NextRequest, NextResponse } from "next/server";
import { runModelBenchmark } from "@/lib/document-intelligence/benchmark";
import { requireAdmin } from "@/lib/admin/auth";
import { writeAuditLog } from "@/lib/admin/audit";

const DEFAULT_PROMPT =
  "Extract every piece of structured data visible in this document as a single flat JSON object. Respond with ONLY the JSON object — no markdown, no explanation.";
const DEFAULT_MAX_TOKENS = 2048;
const MAX_MODELS_PER_RUN = 5; // a handful of real Workers AI calls per click is fine; an unbounded list is not

// Phase 3 item 9 — see ../../../../../src/lib/document-intelligence/benchmark.ts's
// header comment for the full design. Takes a real uploaded file (raster
// image only — see that file's comment on why this doesn't attempt
// PDF/markdown-conversion candidates) plus a comma-separated list of
// Workers AI model IDs, and runs each against the SAME bytes + prompt so
// their outputs are directly comparable.
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request, "document_intelligence.benchmark.run", ["business_admin"]);
  if (!auth.ok) return auth.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ status: "error", message: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = formData.get("file");
  const modelsRaw = String(formData.get("models") ?? "").trim();
  const prompt = String(formData.get("prompt") ?? "").trim() || DEFAULT_PROMPT;
  const maxTokensRaw = formData.get("max_tokens");
  const maxTokens = maxTokensRaw ? Number(maxTokensRaw) : DEFAULT_MAX_TOKENS;

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ status: "error", message: "file is required (a raster image — jpeg/png/webp/gif)." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json(
      { status: "error", message: `Benchmarking only supports raster images today, got "${file.type}". See benchmark.ts's header comment for why.` },
      { status: 400 }
    );
  }

  const models = modelsRaw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length === 0) {
    return NextResponse.json({ status: "error", message: "models is required — a comma-separated list of Workers AI model IDs." }, { status: 400 });
  }
  if (models.length > MAX_MODELS_PER_RUN) {
    return NextResponse.json(
      { status: "error", message: `Too many models in one run (${models.length}) — max ${MAX_MODELS_PER_RUN} per click.` },
      { status: 400 }
    );
  }
  if (!Number.isFinite(maxTokens) || maxTokens < 256 || maxTokens > 32000) {
    return NextResponse.json({ status: "error", message: "max_tokens must be a number between 256 and 32000." }, { status: 400 });
  }

  try {
    const imageBytes = await file.arrayBuffer();
    const results = await runModelBenchmark({ imageBytes, prompt, maxTokens, models });
    await writeAuditLog({
      actor: auth.actor,
      action: "document_intelligence.benchmark.run",
      outcome: "success",
      detail: { models, fileType: file.type, fileSize: file.size },
      request,
    });
    return NextResponse.json({ status: "ok", results });
  } catch (err) {
    await writeAuditLog({
      actor: auth.actor,
      action: "document_intelligence.benchmark.run",
      outcome: "error",
      detail: { models, error: err instanceof Error ? err.message : String(err) },
      request,
    });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Benchmark run failed." },
      { status: 500 }
    );
  }
}
