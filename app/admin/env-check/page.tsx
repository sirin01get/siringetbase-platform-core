"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/admin/AdminGate";

// This deployment's own half of the env-check precheck — see
// src/lib/admin/env-check.ts's header comment for the full design and the
// owner's original request. cafocus/app's /admin/env-check is the combined
// view (this app's report plus its own, with shared-secret fingerprint
// matching); this page is the standalone local view, useful when signed in
// here directly rather than hopping over from cafocus/app's admin hub.
//
// Either admin role — same posture as /admin/sync-queue and every other
// read-only status screen. Plain inline styling, matching this app's other
// /admin/* pages (see sync-queue's own header comment: this app's admin
// surface is deliberately narrow/minimal, not the polished cafocus/app
// design system).

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

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 960 }}>
      <h1>Environment check — platform-core</h1>
      <p>
        Every environment variable this deployment reads (<code>src/config/env.ts</code>), whether it&apos;s
        currently configured, and — for URL-shaped values — whether it looks like a valid one. Never displays a
        secret&apos;s actual value; secrets that must match a same-keyed value on cafocus/app show a short
        fingerprint instead, comparable side by side on cafocus/app&apos;s combined dashboard
        (<code>/admin/env-check</code> there).
      </p>

      <div style={{ margin: "1rem 0", display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <button onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        {report && (
          <span style={{ color: missingCount === 0 && badShapeCount === 0 ? "green" : "crimson", fontWeight: 600 }}>
            {missingCount === 0 && badShapeCount === 0
              ? `All ${report.vars.length} configured`
              : `${missingCount} missing, ${badShapeCount} look malformed, out of ${report.vars.length}`}
          </span>
        )}
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {report && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
              <th style={{ padding: "0.4rem" }}>Variable</th>
              <th style={{ padding: "0.4rem" }}>Scope</th>
              <th style={{ padding: "0.4rem" }}>Purpose</th>
              <th style={{ padding: "0.4rem" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {report.vars.map((v) => (
              <tr key={v.name} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>
                  {v.name} {v.secret && <span style={{ color: "#888" }}>(secret)</span>}
                </td>
                <td style={{ padding: "0.4rem" }}>{v.scope}</td>
                <td style={{ padding: "0.4rem", color: "#555" }}>{v.purpose}</td>
                <td style={{ padding: "0.4rem" }}>
                  {!v.configured ? (
                    <span style={{ color: "crimson" }}>missing</span>
                  ) : v.isUrl && v.validUrl === false ? (
                    <span style={{ color: "darkorange" }}>configured, doesn&apos;t look like a valid URL</span>
                  ) : (
                    <span style={{ color: "green" }}>
                      configured{v.fingerprint ? ` — fingerprint ${v.fingerprint}` : ""}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
