"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/admin/AdminGate";
import {
  Badge,
  Banner,
  buttonSecondary,
  Card,
  EmptyState,
  PageHeader,
  SectionHeading,
  Spinner,
  td,
  th,
  trBody,
} from "@/components/admin/AdminUI";

interface ProviderBreakdownRow {
  provider: string;
  total: number;
  completed: number;
  failed: number;
  successRate: number | null;
  avgDurationMs: number | null;
  avgConfidence: number | null;
}

interface DashboardSummary {
  windowSize: number;
  totalJobs: number;
  completed: number;
  failed: number;
  successRate: number | null;
  avgDurationMs: number | null;
  avgConfidence: number | null;
  confidenceBuckets: { label: string; count: number }[];
  byProvider: ProviderBreakdownRow[];
}

interface MaxTokensAuditRow {
  documentType: string;
  vertical: string;
  maxTokens: number;
  completedCount: number;
  invalidJsonFailureCount: number;
  nearLimitCount: number;
  flagged: boolean;
  recommendation: string;
}

interface CorrectionMiningRow {
  documentType: string;
  vertical: string;
  fieldPath: string;
  correctionCount: number;
  totalReviewedWithCorrection: number;
  examples: { original: unknown; corrected: unknown }[];
}

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${Math.round(v * 100)}%`;
}

function ms(v: number | null): string {
  if (v === null) return "—";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(1)} s`;
}

function providerLabel(p: string): string {
  return p === "workers_ai" ? "Workers AI" : p === "openai" ? "OpenAI" : p === "gemini" ? "Gemini" : p;
}

// Phase 5 item 13 (aggregate dashboard) + Phase 2 items 4/6 (max_tokens
// audit, correction mining) of
// ../../../../document-intelligence/PERFORMANCE_STRATEGY.md — see
// ../../../../src/lib/document-intelligence/metrics.ts for what each
// section actually computes and from which extraction_jobs columns. All
// three sections read the last 500 extraction_jobs rows, so this page is
// necessarily a recent-activity view, not a full-history report.
export default function DocumentIntelligencePerformancePage() {
  return (
    <AdminGate allowedRoles={["business_admin"]}>
      {() => <PerformancePageInner />}
    </AdminGate>
  );
}

function PerformancePageInner() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [maxTokensAudit, setMaxTokensAudit] = useState<MaxTokensAuditRow[]>([]);
  const [correctionMining, setCorrectionMining] = useState<CorrectionMiningRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedField, setExpandedField] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/document-intelligence/performance");
    const body = (await res.json().catch(() => ({}))) as {
      status: string;
      summary?: DashboardSummary;
      maxTokensAudit?: MaxTokensAuditRow[];
      correctionMining?: CorrectionMiningRow[];
      message?: string;
    };
    if (body.status !== "ok") {
      setError(body.message ?? "Failed to load performance report.");
      setLoading(false);
      return;
    }
    setSummary(body.summary ?? null);
    setMaxTokensAudit(body.maxTokensAudit ?? []);
    setCorrectionMining(body.correctionMining ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Document intelligence — performance"
        description={
          <p>
            Read-only analysis over the most recent {summary?.windowSize ?? 500} extraction jobs: overall health, a
            per-template audit of whether{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]">max_tokens</code> is set high enough,
            and which fields reviewers correct most often. Nothing here writes back to a template automatically —
            act on a flagged row from the{" "}
            <a href="/admin/document-intelligence" className="font-medium text-slate-900 underline decoration-dotted">
              extraction templates
            </a>{" "}
            page yourself, or try alternatives first on the{" "}
            <a href="/admin/document-intelligence/benchmark" className="font-medium text-slate-900 underline decoration-dotted">
              model benchmark tool
            </a>
            .
          </p>
        }
      />

      {error && <Banner tone="red" className="mb-5">{error}</Banner>}

      <div className="mb-5 flex justify-end">
        <button type="button" onClick={() => void load()} disabled={loading} className={buttonSecondary}>
          {loading ? (
            <span className="flex items-center gap-2">
              <Spinner /> Refreshing…
            </span>
          ) : (
            "Refresh"
          )}
        </button>
      </div>

      {loading && !summary ? (
        <EmptyState>Loading…</EmptyState>
      ) : (
        <>
          <SectionHeading className="mb-3">Overview</SectionHeading>
          {!summary || summary.totalJobs === 0 ? (
            <EmptyState>No extraction jobs recorded yet.</EmptyState>
          ) : (
            <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Card className="p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Jobs (window)</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{summary.totalJobs}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Success rate</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{pct(summary.successRate)}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {summary.completed} completed / {summary.failed} failed
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Avg. duration</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{ms(summary.avgDurationMs)}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Avg. confidence</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {summary.avgConfidence === null ? "—" : summary.avgConfidence.toFixed(2)}
                </div>
              </Card>
            </div>
          )}

          {summary && summary.confidenceBuckets.some((b) => b.count > 0) && (
            <Card className="mb-8 p-5">
              <div className="mb-3 text-sm font-semibold text-slate-900">Confidence distribution</div>
              <div className="flex items-end gap-3" style={{ height: 96 }}>
                {summary.confidenceBuckets.map((b) => {
                  const max = Math.max(...summary.confidenceBuckets.map((x) => x.count), 1);
                  const heightPct = (b.count / max) * 100;
                  return (
                    <div key={b.label} className="flex flex-1 flex-col items-center gap-1.5">
                      <div className="flex h-full w-full items-end">
                        <div
                          className="w-full rounded-t bg-slate-800"
                          style={{ height: `${Math.max(heightPct, b.count > 0 ? 6 : 0)}%` }}
                          title={`${b.count} job(s)`}
                        />
                      </div>
                      <div className="text-xs text-slate-500">{b.label}</div>
                      <div className="text-xs font-medium text-slate-700">{b.count}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {summary && summary.byProvider.length > 0 && (
            <Card className="mb-8 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className={th}>Provider</th>
                      <th className={th}>Total</th>
                      <th className={th}>Success rate</th>
                      <th className={th}>Avg. duration</th>
                      <th className={th}>Avg. confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byProvider.map((p) => (
                      <tr key={p.provider} className={trBody}>
                        <td className={`${td} font-medium text-slate-900`}>{providerLabel(p.provider)}</td>
                        <td className={td}>{p.total}</td>
                        <td className={td}>{pct(p.successRate)}</td>
                        <td className={td}>{ms(p.avgDurationMs)}</td>
                        <td className={td}>{p.avgConfidence === null ? "—" : p.avgConfidence.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <SectionHeading
            className="mb-3"
            subtitle="Which registered templates show signs of a max_tokens ceiling that's too low."
          >
            Max output tokens audit
          </SectionHeading>
          {maxTokensAudit.length === 0 ? (
            <EmptyState>No completed or failed jobs against a registered template in this window.</EmptyState>
          ) : (
            <Card className="mb-8 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className={th}>Document type</th>
                      <th className={th}>Vertical</th>
                      <th className={th}>Max tokens</th>
                      <th className={th}>Status</th>
                      <th className={th}>Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maxTokensAudit.map((r) => (
                      <tr key={`${r.vertical}::${r.documentType}`} className={trBody}>
                        <td className={`${td} font-medium text-slate-900`}>{r.documentType}</td>
                        <td className={td}>{r.vertical}</td>
                        <td className={td}>{r.maxTokens}</td>
                        <td className={td}>
                          <Badge tone={r.flagged ? "amber" : "green"}>{r.flagged ? "Flagged" : "Healthy"}</Badge>
                        </td>
                        <td className={`${td} max-w-sm text-slate-500`}>{r.recommendation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <SectionHeading
            className="mb-3"
            subtitle="Fields a reviewer most often changed after the model's first pass — see field-validation.ts for a related but different check (format/checksum, not human review)."
          >
            Correction mining
          </SectionHeading>
          {correctionMining.length === 0 ? (
            <EmptyState>
              No reviewed-and-corrected jobs in this window yet — nothing to mine until a CA or admin edits an
              extracted field.
            </EmptyState>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className={th}>Document type</th>
                      <th className={th}>Field</th>
                      <th className={th}>Corrections</th>
                      <th className={th}>Of reviewed jobs</th>
                      <th className={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {correctionMining.map((r) => {
                      const key = `${r.vertical}::${r.documentType}::${r.fieldPath}`;
                      return (
                        <Fragment key={key}>
                          <tr className={trBody}>
                            <td className={`${td} font-medium text-slate-900`}>
                              {r.documentType} <span className="text-slate-400">({r.vertical})</span>
                            </td>
                            <td className={`${td} font-mono text-[0.85em]`}>{r.fieldPath}</td>
                            <td className={td}>{r.correctionCount}</td>
                            <td className={td}>{r.totalReviewedWithCorrection}</td>
                            <td className={td}>
                              <button
                                type="button"
                                onClick={() => setExpandedField(expandedField === key ? null : key)}
                                className="text-xs font-medium text-slate-600 underline decoration-dotted"
                              >
                                {expandedField === key ? "Hide examples" : "Show examples"}
                              </button>
                            </td>
                          </tr>
                          {expandedField === key && (
                            <tr>
                              <td colSpan={5} className="bg-slate-50/70 px-4 py-3">
                                <div className="flex flex-col gap-2">
                                  {r.examples.map((ex, i) => (
                                    <div key={i} className="grid grid-cols-2 gap-3 text-xs">
                                      <div>
                                        <div className="mb-0.5 font-medium text-slate-500">Model said</div>
                                        <div className="rounded border border-slate-200 bg-white px-2 py-1 font-mono">
                                          {JSON.stringify(ex.original)}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="mb-0.5 font-medium text-slate-500">Reviewer corrected to</div>
                                        <div className="rounded border border-slate-200 bg-white px-2 py-1 font-mono">
                                          {JSON.stringify(ex.corrected)}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
