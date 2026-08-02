"use client";

import { useRef, useState, type FormEvent } from "react";
import AdminGate from "@/components/admin/AdminGate";
import {
  Badge,
  Banner,
  buttonPrimary,
  Card,
  EmptyState,
  hintClass,
  inputClass,
  labelClass,
  PageHeader,
  SectionHeading,
  Spinner,
  td,
  th,
  trBody,
} from "@/components/admin/AdminUI";

interface BenchmarkResultRow {
  model: string;
  ok: boolean;
  latencyMs: number;
  outputChars: number | null;
  looksLikeValidJson: boolean;
  outputPreview: string | null;
  error: string | null;
}

const DEFAULT_PROMPT =
  "Extract every piece of structured data visible in this document as a single flat JSON object. Respond with ONLY the JSON object — no markdown, no explanation.";

// Phase 3 item 9 of ../../../../document-intelligence/PERFORMANCE_STRATEGY.md
// — see ../../../../src/lib/document-intelligence/benchmark.ts's header
// comment for the full design. A side tool, not part of the real pipeline:
// upload one test image, list candidate Workers AI vision model IDs, and
// see latency + rough output-quality side by side before ever touching
// model-gateway.ts's real MODEL constant.
export default function DocumentIntelligenceBenchmarkPage() {
  return (
    <AdminGate allowedRoles={["business_admin"]}>
      {() => <BenchmarkPageInner />}
    </AdminGate>
  );
}

function BenchmarkPageInner() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [models, setModels] = useState("@cf/meta/llama-3.2-11b-vision-instruct");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [maxTokens, setMaxTokens] = useState("2048");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BenchmarkResultRow[] | null>(null);

  async function handleRun(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResults(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose an image file to benchmark against first.");
      return;
    }

    setRunning(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("models", models);
    formData.append("prompt", prompt);
    formData.append("max_tokens", maxTokens);

    const res = await fetch("/api/admin/document-intelligence/benchmark", { method: "POST", body: formData });
    const body = (await res.json().catch(() => ({}))) as { status: string; results?: BenchmarkResultRow[]; message?: string };
    if (body.status !== "ok") {
      setError(body.message ?? "Benchmark run failed.");
    } else {
      setResults(body.results ?? []);
    }
    setRunning(false);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Document intelligence — model benchmark"
        description={
          <p>
            Runs the same uploaded image + prompt against multiple Workers AI vision model IDs, one at a time, and
            shows latency and a rough &ldquo;did it return parseable JSON&rdquo; signal side by side. See{" "}
            <a
              href="https://developers.cloudflare.com/workers-ai/models/"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-slate-900 underline decoration-dotted"
            >
              Cloudflare&apos;s model catalog
            </a>{" "}
            (filter by Vision) for candidate model IDs — a model not yet licensed on this account will show a clear
            error here rather than failing the whole run. This is a comparison tool only: nothing here changes the
            real pipeline&apos;s model, which is still the single{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]">MODEL</code> constant in{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]">src/lib/document-intelligence/model-gateway.ts</code>.
          </p>
        }
      />

      {error && <Banner tone="red" className="mb-5">{error}</Banner>}

      <Card className="mb-8 p-5">
        <form onSubmit={(e) => void handleRun(e)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>
            Test image <span className={hintClass}>(jpeg/png/webp/gif — a real, representative document works best)</span>
            <input ref={fileInputRef} type="file" accept="image/*" className={`${inputClass} mt-1.5`} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Candidate models <span className={hintClass}>(comma-separated Workers AI model IDs, up to 5)</span>
            <input value={models} onChange={(e) => setModels(e.target.value)} className={`${inputClass} mt-1.5 font-mono text-[0.85em]`} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Prompt
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className={`${inputClass} mt-1.5`} />
          </label>
          <label className={labelClass}>
            Max output tokens
            <input
              type="number"
              min="256"
              max="32000"
              step="256"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className={`${inputClass} mt-1.5`}
            />
          </label>
          <div className="flex items-end sm:col-span-2">
            <button type="submit" disabled={running} className={buttonPrimary}>
              {running ? (
                <span className="flex items-center gap-2">
                  <Spinner /> Running…
                </span>
              ) : (
                "Run benchmark"
              )}
            </button>
          </div>
        </form>
      </Card>

      <SectionHeading className="mb-3">Results</SectionHeading>
      {!results ? (
        <EmptyState>Run a benchmark above to see results here.</EmptyState>
      ) : results.length === 0 ? (
        <EmptyState>No results returned.</EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className={th}>Model</th>
                  <th className={th}>Status</th>
                  <th className={th}>Latency</th>
                  <th className={th}>Output length</th>
                  <th className={th}>Looks like valid JSON</th>
                  <th className={th}>Preview / error</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.model} className={trBody}>
                    <td className={`${td} max-w-[220px] break-all font-mono text-[0.85em] text-slate-900`}>{r.model}</td>
                    <td className={td}>
                      <Badge tone={r.ok ? "green" : "red"}>{r.ok ? "OK" : "Error"}</Badge>
                    </td>
                    <td className={td}>{(r.latencyMs / 1000).toFixed(1)}s</td>
                    <td className={td}>{r.outputChars ?? "—"}</td>
                    <td className={td}>
                      {r.ok ? <Badge tone={r.looksLikeValidJson ? "green" : "amber"}>{r.looksLikeValidJson ? "Yes" : "No"}</Badge> : "—"}
                    </td>
                    <td className={`${td} max-w-sm whitespace-pre-wrap font-mono text-[0.8em] text-slate-500`}>
                      {r.error ?? r.outputPreview}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </main>
  );
}
