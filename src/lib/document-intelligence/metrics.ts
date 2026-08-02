import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Phase 2 item 4 (max_tokens audit), Phase 2 item 6 (correction mining), and
// Phase 5 item 13 (aggregate dashboard) of
// ../../../document-intelligence/PERFORMANCE_STRATEGY.md, combined into one
// service file since all three read the same underlying extraction_jobs
// rows and are surfaced together on one admin page
// (app/admin/document-intelligence/performance/page.tsx) rather than three
// separate screens.
//
// Everything here is READ-ONLY analysis over extraction_jobs — none of it
// writes back to extraction_templates automatically. Item 4's own strategy
// doc phrasing is "audit", not "auto-tune": a human still decides whether to
// act on a flagged template, same "no auto-apply" posture the ITR gov-change
// agent's draft-apply link already established for a very similar
// judgment call (see that feature's analysis doc).

// Bounded to the most recent N jobs — same reasoning as extract.ts's own
// isWorkersAiCircuitOpen() window: cheap to query, and recent behavior is
// what actually matters for "is this still a problem right now", not the
// full historical table.
const METRICS_WINDOW = 500;

interface RawJobRow {
  id: string;
  template_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  raw_output: Record<string, unknown> | null;
  interpretation: Record<string, unknown> | null;
  corrected_interpretation: Record<string, unknown> | null;
  confidence: number | null;
  model_provider: "workers_ai" | "openai" | "gemini";
  created_at: string;
  completed_at: string | null;
}

interface TemplateMeta {
  documentType: string;
  vertical: string;
  maxTokens: number;
}

async function loadRecentJobsAndTemplateMap(): Promise<{
  jobs: RawJobRow[];
  templateById: Map<string, TemplateMeta>;
}> {
  const supabase = createSupabaseServiceRoleClient();

  const { data: jobs, error: jobsError } = await supabase
    .from("extraction_jobs")
    .select(
      "id, template_id, status, raw_output, interpretation, corrected_interpretation, confidence, model_provider, created_at, completed_at"
    )
    .order("created_at", { ascending: false })
    .limit(METRICS_WINDOW);
  if (jobsError) throw new Error(jobsError.message);

  const { data: templates, error: templatesError } = await supabase
    .from("extraction_templates")
    .select("id, document_type, vertical, max_tokens");
  if (templatesError) throw new Error(templatesError.message);

  const templateById = new Map<string, TemplateMeta>();
  for (const t of templates ?? []) {
    templateById.set(t.id, { documentType: t.document_type, vertical: t.vertical, maxTokens: t.max_tokens });
  }

  return { jobs: jobs ?? [], templateById };
}

function durationMsOf(job: RawJobRow): number | null {
  const raw = job.raw_output;
  if (raw && typeof raw.durationMs === "number") return raw.durationMs;
  return null;
}

// ---------------------------------------------------------------------------
// Phase 5 item 13 — aggregate dashboard
// ---------------------------------------------------------------------------

export interface ProviderBreakdownRow {
  provider: string;
  total: number;
  completed: number;
  failed: number;
  successRate: number | null;
  avgDurationMs: number | null;
  avgConfidence: number | null;
}

export interface DashboardSummary {
  windowSize: number;
  totalJobs: number;
  completed: number;
  failed: number;
  successRate: number | null;
  avgDurationMs: number | null;
  avgConfidence: number | null;
  // Fixed bands rather than a histogram library — five buckets is plenty
  // for "is this pipeline's confidence generally healthy" at a glance.
  confidenceBuckets: { label: string; count: number }[];
  byProvider: ProviderBreakdownRow[];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const { jobs } = await loadRecentJobsAndTemplateMap();

  const completed = jobs.filter((j) => j.status === "completed");
  const failed = jobs.filter((j) => j.status === "failed");
  const terminal = completed.length + failed.length;

  const durations = completed.map(durationMsOf).filter((d): d is number => d !== null);
  const confidences = completed.map((j) => j.confidence).filter((c): c is number => c !== null);

  const buckets = [
    { label: "0.0–0.2", min: 0, max: 0.2 },
    { label: "0.2–0.4", min: 0.2, max: 0.4 },
    { label: "0.4–0.6", min: 0.4, max: 0.6 },
    { label: "0.6–0.8", min: 0.6, max: 0.8 },
    { label: "0.8–1.0", min: 0.8, max: 1.01 },
  ];
  const confidenceBuckets = buckets.map((b) => ({
    label: b.label,
    count: confidences.filter((c) => c >= b.min && c < b.max).length,
  }));

  const providers: Array<"workers_ai" | "openai" | "gemini"> = ["workers_ai", "openai", "gemini"];
  const byProvider: ProviderBreakdownRow[] = providers
    .map((provider) => {
      const providerJobs = jobs.filter((j) => j.model_provider === provider);
      const providerCompleted = providerJobs.filter((j) => j.status === "completed");
      const providerFailed = providerJobs.filter((j) => j.status === "failed");
      const providerTerminal = providerCompleted.length + providerFailed.length;
      return {
        provider,
        total: providerJobs.length,
        completed: providerCompleted.length,
        failed: providerFailed.length,
        successRate: providerTerminal > 0 ? providerCompleted.length / providerTerminal : null,
        avgDurationMs: average(providerCompleted.map(durationMsOf).filter((d): d is number => d !== null)),
        avgConfidence: average(providerCompleted.map((j) => j.confidence).filter((c): c is number => c !== null)),
      };
    })
    // Omit a provider with zero jobs entirely — e.g. openai/gemini rows are
    // just noise on a deployment where OPENAI_API_KEY/GEMINI_API_KEY were
    // never set and the fallback chain has never had a reason to run.
    .filter((row) => row.total > 0);

  return {
    windowSize: jobs.length,
    totalJobs: jobs.length,
    completed: completed.length,
    failed: failed.length,
    successRate: terminal > 0 ? completed.length / terminal : null,
    avgDurationMs: average(durations),
    avgConfidence: average(confidences),
    confidenceBuckets,
    byProvider,
  };
}

// ---------------------------------------------------------------------------
// Phase 2 item 4 — max_tokens audit
// ---------------------------------------------------------------------------

export interface MaxTokensAuditRow {
  documentType: string;
  vertical: string;
  maxTokens: number;
  completedCount: number;
  invalidJsonFailureCount: number;
  // "near the ceiling" — completed jobs whose raw response text is already
  // using >=85% of maxTokens by a rough chars/4 token estimate (the same
  // approximation the admin UI's own tooltip on this field already gestures
  // at — see app/admin/document-intelligence/page.tsx). Not exact (real
  // tokenization varies by provider/model), but good enough to flag "this
  // is cutting it close" before it actually starts truncating.
  nearLimitCount: number;
  flagged: boolean;
  recommendation: string;
}

const CHARS_PER_TOKEN_ESTIMATE = 4;
const NEAR_LIMIT_RATIO = 0.85;

export async function getMaxTokensAudit(): Promise<MaxTokensAuditRow[]> {
  const { jobs, templateById } = await loadRecentJobsAndTemplateMap();

  interface Bucket {
    documentType: string;
    vertical: string;
    maxTokens: number;
    completedCount: number;
    invalidJsonFailureCount: number;
    nearLimitCount: number;
  }
  const byTemplate = new Map<string, Bucket>();

  for (const job of jobs) {
    const meta = templateById.get(job.template_id);
    if (!meta) continue; // template since deleted/renamed — nothing to attribute this job to

    const key = job.template_id;
    let bucket = byTemplate.get(key);
    if (!bucket) {
      bucket = {
        documentType: meta.documentType,
        vertical: meta.vertical,
        maxTokens: meta.maxTokens,
        completedCount: 0,
        invalidJsonFailureCount: 0,
        nearLimitCount: 0,
      };
      byTemplate.set(key, bucket);
    }

    if (job.status === "completed") {
      bucket.completedCount++;
      const text = typeof job.raw_output?.text === "string" ? (job.raw_output.text as string) : null;
      if (text) {
        const estimatedTokens = text.length / CHARS_PER_TOKEN_ESTIMATE;
        if (estimatedTokens >= bucket.maxTokens * NEAR_LIMIT_RATIO) bucket.nearLimitCount++;
      }
    } else if (job.status === "failed") {
      // writeExtractionFailure() (extract.ts) stores { text: rawText } as
      // raw_output specifically for the "Model output wasn't valid JSON"
      // case — every other failure reason (missing template, unsupported
      // content type, fallback-exhausted) stores a differently-shaped
      // raw_output without a `text` field. That's the signal used here to
      // isolate "probably a truncation-driven parse failure" from "failed
      // for an unrelated reason" without needing to string-match the
      // `reason` text itself.
      if (typeof job.raw_output?.text === "string") bucket.invalidJsonFailureCount++;
    }
  }

  return Array.from(byTemplate.values())
    .map((b) => {
      const flagged = b.invalidJsonFailureCount > 0 || b.nearLimitCount > 0;
      let recommendation = "No action needed — no truncation signal in recent jobs.";
      if (b.invalidJsonFailureCount > 0) {
        recommendation = `${b.invalidJsonFailureCount} recent failure(s) look like truncated JSON — consider raising max_tokens above ${b.maxTokens}.`;
      } else if (b.nearLimitCount > 0) {
        recommendation = `${b.nearLimitCount} recent completed job(s) used ~${Math.round(NEAR_LIMIT_RATIO * 100)}%+ of the ${b.maxTokens}-token ceiling — still succeeding, but worth raising before it starts failing.`;
      }
      return { ...b, flagged, recommendation };
    })
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.invalidJsonFailureCount - a.invalidJsonFailureCount);
}

// ---------------------------------------------------------------------------
// Phase 2 item 6 — mine corrected_interpretation vs interpretation
// ---------------------------------------------------------------------------

export interface CorrectionMiningRow {
  documentType: string;
  vertical: string;
  fieldPath: string;
  correctionCount: number;
  totalReviewedWithCorrection: number;
  examples: { original: unknown; corrected: unknown }[];
}

const MAX_EXAMPLES_PER_FIELD = 3;

// Shallow (top-level key) diff — matches how every extraction_templates
// output_schema in this codebase is actually shaped (a flat object of
// scalar/array fields, not nested records; see ./field-validation.ts's own
// walkObject() for the same top-level-fields assumption). A field that's
// present in one side and missing in the other counts as a correction too.
function diffTopLevelFields(
  original: Record<string, unknown>,
  corrected: Record<string, unknown>
): Array<{ field: string; original: unknown; corrected: unknown }> {
  const fields = new Set([...Object.keys(original), ...Object.keys(corrected)]);
  const out: Array<{ field: string; original: unknown; corrected: unknown }> = [];
  for (const field of fields) {
    const a = original[field];
    const b = corrected[field];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field, original: a, corrected: b });
  }
  return out;
}

export async function getCorrectionMiningReport(): Promise<CorrectionMiningRow[]> {
  const { jobs, templateById } = await loadRecentJobsAndTemplateMap();

  interface Bucket {
    documentType: string;
    vertical: string;
    correctionCount: number;
    totalReviewedWithCorrection: number;
    examples: { original: unknown; corrected: unknown }[];
  }
  const byTemplateAndField = new Map<string, Bucket>();

  for (const job of jobs) {
    if (!job.corrected_interpretation || !job.interpretation) continue;
    const meta = templateById.get(job.template_id);
    if (!meta) continue;

    const diffs = diffTopLevelFields(job.interpretation, job.corrected_interpretation);
    if (diffs.length === 0) continue; // reviewed and confirmed as-is, not a correction

    for (const diff of diffs) {
      const key = `${meta.vertical}::${meta.documentType}::${diff.field}`;
      let bucket = byTemplateAndField.get(key);
      if (!bucket) {
        bucket = {
          documentType: meta.documentType,
          vertical: meta.vertical,
          correctionCount: 0,
          totalReviewedWithCorrection: 0,
          examples: [],
        };
        byTemplateAndField.set(key, bucket);
      }
      bucket.correctionCount++;
      if (bucket.examples.length < MAX_EXAMPLES_PER_FIELD) {
        bucket.examples.push({ original: diff.original, corrected: diff.corrected });
      }
    }
  }

  // totalReviewedWithCorrection is really "how many distinct reviewed jobs
  // touched this (documentType, vertical) at all" — a second pass so it's
  // not just correctionCount's own field-level tally restated.
  const reviewedJobCountByTemplate = new Map<string, number>();
  for (const job of jobs) {
    if (!job.corrected_interpretation || !job.interpretation) continue;
    const meta = templateById.get(job.template_id);
    if (!meta) continue;
    const key = `${meta.vertical}::${meta.documentType}`;
    reviewedJobCountByTemplate.set(key, (reviewedJobCountByTemplate.get(key) ?? 0) + 1);
  }

  return Array.from(byTemplateAndField.entries())
    .map(([key, bucket]) => {
      const fieldPath = key.split("::")[2] ?? "";
      const templateKey = `${bucket.vertical}::${bucket.documentType}`;
      return {
        documentType: bucket.documentType,
        vertical: bucket.vertical,
        fieldPath,
        correctionCount: bucket.correctionCount,
        totalReviewedWithCorrection: reviewedJobCountByTemplate.get(templateKey) ?? bucket.correctionCount,
        examples: bucket.examples,
      };
    })
    .sort((a, b) => b.correctionCount - a.correctionCount);
}
