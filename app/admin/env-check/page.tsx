"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/admin/AdminGate";
import { Badge, buttonSecondary, Card, EmptyState, PageHeader, Spinner, td, th, trBody } from "@/components/admin/AdminUI";

// This deployment's own half of the env-check precheck — see
// src/lib/admin/env-check.ts's header comment for the full design and the
// owner's original request. cafocus/app's /admin/env-check is the combined
// view (this app's report plus its own, with shared-secret fingerprint
// matching); this page is the standalone local view, useful when signed in
// here directly rather than hopping over from cafocus/app's admin hub.
//
// Either admin role — same posture as /admin/sync-queue and every other
// read-only status screen. Tailwind-styled via src/components/admin/AdminUI.tsx,
// matching this app's other /admin/* pages.

interface EnvVarResult {
  name: string;
  scope: "build" | "runtime";
  secret: boolean;
  purpose: string;
  isUrl?: boolean;
  mustMatchKey?: string;
  configured: boolean;
  validUrl: boolean | null;
  fingerprint: string | null;
  testResult: "pass" | "fail" | "not_tested";
  testMessage: string | null;
}

interface EnvCheckReport {
  app: string;
  timestamp: string;
  vars: EnvVarResult[];
}

export default function EnvCheckAdminPage() {
  return (
    <AdminGate allowedRoles={["business_admin", "support_admin"]}>
      {() => <EnvCheckAdminPageInner />}
    </AdminGate>
  );
}

function EnvCheckAdminPageInner() {
  const [report, setReport] = useState<EnvCheckReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/env-check");
      const body = (await res.json().catch(() => ({}))) as { status: string; report?: EnvCheckReport; message?: string };
      if (body.status !== "ok" || !body.report) throw new Error(body.message ?? "Failed to load env check.");
      setReport(body.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const missingCount = report?.vars.filter((v) => !v.configured).length ?? 0;
  const badShapeCount = report?.vars.filter((v) => v.configured && v.isUrl && v.validUrl === false).length ?? 0;
  const testFailedCount = report?.vars.filter((v) => v.testResult === "fail").length ?? 0;
  const allOk = missingCount === 0 && badShapeCount === 0 && testFailedCount === 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Environment check — platform-core"
        description={
          <>
            Every environment variable this deployment reads (<code className="rounded bg-slate-100 px-1 py-0.5 text-[0.8em]">src/config/env.ts</code>
            ), whether it&apos;s currently configured, and — for URL-shaped values — whether it looks like a valid one.
            Never displays a secret&apos;s actual value; secrets that must match a same-keyed value on cafocus/app show
            a short fingerprint instead, comparable side by side on cafocus/app&apos;s combined dashboard (
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.8em]">/admin/env-check</code> there). &ldquo;Test
            result&rdquo; is a real, live, side-effect-free probe for anything that&apos;s a secret or a key to another
            service — plain config flags stay &ldquo;not tested&rdquo; since there&apos;s nothing external to check.
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button onClick={() => void load()} disabled={loading} className={buttonSecondary}>
          {loading ? (
            <span className="flex items-center gap-2">
              <Spinner /> Loading…
            </span>
          ) : (
            "Refresh"
          )}
        </button>
        {report && (
          <Badge tone={allOk ? "green" : "red"}>
            {allOk
              ? `All ${report.vars.length} configured`
              : `${missingCount} missing, ${badShapeCount} look malformed, ${testFailedCount} failed test, out of ${report.vars.length}`}
          </Badge>
        )}
      </div>

      {error && (
        <Card className="mb-5 border-rose-100 bg-rose-50 p-4 text-sm text-rose-700 shadow-none">{error}</Card>
      )}

      {loading && !report ? (
        <EmptyState>Loading environment report…</EmptyState>
      ) : (
        report && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className={th}>Variable</th>
                    <th className={th}>Scope</th>
                    <th className={th}>Purpose</th>
                    <th className={th}>Status</th>
                    <th className={th}>Test result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.vars.map((v) => (
                    <tr key={v.name} className={trBody}>
                      <td className={`${td} font-mono text-[0.85em]`}>
                        {v.name} {v.secret && <span className="ml-1 text-slate-400">(secret)</span>}
                      </td>
                      <td className={td}>
                        <span className="text-slate-500">{v.scope}</span>
                      </td>
                      <td className={`${td} text-slate-500`}>{v.purpose}</td>
                      <td className={td}>
                        {!v.configured ? (
                          <Badge tone="red">missing</Badge>
                        ) : v.isUrl && v.validUrl === false ? (
                          <Badge tone="amber">doesn&apos;t look like a valid URL</Badge>
                        ) : (
                          <Badge tone="green">
                            configured{v.fingerprint ? ` — ${v.fingerprint}` : ""}
                          </Badge>
                        )}
                      </td>
                      <td className={td} title={v.testMessage ?? undefined}>
                        {v.testResult === "pass" ? (
                          <Badge tone="green">tested — ok</Badge>
                        ) : v.testResult === "fail" ? (
                          <Badge tone="red">tested — failed</Badge>
                        ) : (
                          <Badge tone="slate">not tested</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}
    </main>
  );
}
