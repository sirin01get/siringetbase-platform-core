"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/admin/AdminGate";
import { Badge, Banner, buttonPrimary, buttonSecondary, Card, EmptyState, PageHeader, Spinner, td, th, trBody } from "@/components/admin/AdminUI";

// Minimal admin view over entity_sync_queue rows that need attention —
// 'dead_letter' (exhausted automatic retries), legacy 'failed', and
// 'pending' rows still backing off. Backed by
// app/api/admin/sync-queue/route.ts (list) and
// app/api/admin/sync-queue/retry/route.ts (reset + immediate drain).
//
// Deliberately narrow — this is NOT the cross-vertical operator console
// described in ../../../entity-graph/../admin/README.md (dispute review,
// ServiceProvider verification, fraud review). It does one thing: let
// someone see unsynced rows and push them back into the graph.
//
// support_admin only (the owner's own naming — see README.md "Access
// control") — the "other Q [queue] activities" side. Every retry here is
// audit-logged (see app/api/admin/sync-queue/retry/route.ts). Tailwind-styled
// via src/components/admin/AdminUI.tsx, matching this app's other /admin/* pages.

interface QueueRow {
  id: string;
  entity_type: string;
  vertical: string;
  operation: string;
  payload: { role_profile_id: string; role: string; status: string };
  status: string;
  attempts: number;
  error: string | null;
  created_at: string;
  next_attempt_at: string;
}

interface DrainResult {
  processed: number;
  retryScheduled: number;
  deadLettered: number;
}

const statusTone: Record<string, "green" | "red" | "amber" | "slate"> = {
  dead_letter: "red",
  failed: "red",
  pending: "amber",
};

export default function SyncQueueAdminPage() {
  return (
    <AdminGate allowedRoles={["support_admin"]}>
      {() => <SyncQueueAdminPageInner />}
    </AdminGate>
  );
}

function SyncQueueAdminPageInner() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ requeued: number; drainResult: DrainResult } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/sync-queue");
      const json = (await res.json()) as { status: string; rows?: QueueRow[]; message?: string };
      if (json.status !== "ok" || !json.rows) {
        setLoadError(json.message ?? "Failed to load queue.");
        setRows([]);
      } else {
        setRows(json.rows);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  async function retrySelected() {
    if (selected.size === 0) return;
    setRetrying(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/admin/sync-queue/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const json = (await res.json()) as {
        status: string;
        requeued?: number;
        drainResult?: DrainResult;
        message?: string;
      };
      if (json.status === "ok" && json.requeued !== undefined && json.drainResult) {
        setLastResult({ requeued: json.requeued, drainResult: json.drainResult });
        setSelected(new Set());
        await load();
      } else {
        setLoadError(json.message ?? "Retry failed.");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Entity sync queue — unsynced rows"
        description={
          <>
            Rows in <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.8em]">dead_letter</code> (exhausted
            automatic retries), legacy <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.8em]">failed</code>,
            or <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.8em]">pending</code> still backing off. Select
            rows and retry to reset them and immediately drain the queue — see{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.8em]">src/lib/entity-graph/sync.ts</code> and{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.8em]">../../entity-graph/data-sync-architecture.md</code>{" "}
            for how automatic retry/backoff normally works.
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
        <button onClick={() => void retrySelected()} disabled={retrying || selected.size === 0} className={buttonPrimary}>
          {retrying ? (
            <span className="flex items-center gap-2">
              <Spinner /> Retrying…
            </span>
          ) : (
            `Retry selected (${selected.size})`
          )}
        </button>
      </div>

      {loadError && <Banner tone="red" className="mb-5">{loadError}</Banner>}

      {lastResult && (
        <Banner tone="green" className="mb-5">
          Requeued {lastResult.requeued} row(s). Drain result: {lastResult.drainResult.processed} processed,{" "}
          {lastResult.drainResult.retryScheduled} rescheduled for retry, {lastResult.drainResult.deadLettered}{" "}
          dead-lettered.
        </Banner>
      )}

      {!loading && rows.length === 0 && !loadError && <EmptyState>Nothing needs attention right now.</EmptyState>}

      {rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className={th}>
                    <input
                      type="checkbox"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                    />
                  </th>
                  <th className={th}>Status</th>
                  <th className={th}>Vertical</th>
                  <th className={th}>Role</th>
                  <th className={th}>Attempts</th>
                  <th className={th}>Error</th>
                  <th className={th}>Created</th>
                  <th className={th}>Next attempt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={trBody}>
                    <td className={td}>
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                      />
                    </td>
                    <td className={td}>
                      <Badge tone={statusTone[row.status] ?? "slate"}>{row.status}</Badge>
                    </td>
                    <td className={td}>{row.vertical}</td>
                    <td className={td}>{row.payload?.role ?? "—"}</td>
                    <td className={td}>{row.attempts}</td>
                    <td className={`${td} max-w-[280px] truncate text-slate-500`} title={row.error ?? undefined}>
                      {row.error ?? "—"}
                    </td>
                    <td className={`${td} whitespace-nowrap text-slate-500`}>{new Date(row.created_at).toLocaleString()}</td>
                    <td className={`${td} whitespace-nowrap text-slate-500`}>{new Date(row.next_attempt_at).toLocaleString()}</td>
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
