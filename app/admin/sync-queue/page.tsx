"use client";

import { useCallback, useEffect, useState } from "react";

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
// No auth gate yet, same dev-phase-convenience posture as every other
// unauthenticated route in this app right now — see the API routes'
// header comments. Protect before anything resembling a public launch.

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

export default function SyncQueueAdminPage() {
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
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 960 }}>
      <h1>Entity Sync Queue — Unsynced Rows</h1>
      <p>
        Rows in <code>dead_letter</code> (exhausted automatic retries), legacy <code>failed</code>, or{" "}
        <code>pending</code> still backing off. Select rows and retry to reset them and immediately drain the
        queue — see <code>src/lib/entity-graph/sync.ts</code> and{" "}
        <code>../../entity-graph/data-sync-architecture.md</code> for how automatic retry/backoff normally
        works.
      </p>

      <div style={{ margin: "1rem 0", display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <button onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button onClick={() => void retrySelected()} disabled={retrying || selected.size === 0}>
          {retrying ? "Retrying…" : `Retry Selected (${selected.size})`}
        </button>
      </div>

      {loadError && <p style={{ color: "crimson" }}>Error: {loadError}</p>}

      {lastResult && (
        <p style={{ background: "#eef7ee", padding: "0.75rem", borderRadius: 4 }}>
          Requeued {lastResult.requeued} row(s). Drain result: {lastResult.drainResult.processed} processed,{" "}
          {lastResult.drainResult.retryScheduled} rescheduled for retry, {lastResult.drainResult.deadLettered}{" "}
          dead-lettered.
        </p>
      )}

      {!loading && rows.length === 0 && !loadError && <p>Nothing needs attention right now.</p>}

      {rows.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
              <th style={{ padding: "0.4rem" }}>
                <input
                  type="checkbox"
                  checked={selected.size === rows.length && rows.length > 0}
                  onChange={toggleAll}
                />
              </th>
              <th style={{ padding: "0.4rem" }}>Status</th>
              <th style={{ padding: "0.4rem" }}>Vertical</th>
              <th style={{ padding: "0.4rem" }}>Role</th>
              <th style={{ padding: "0.4rem" }}>Attempts</th>
              <th style={{ padding: "0.4rem" }}>Error</th>
              <th style={{ padding: "0.4rem" }}>Created</th>
              <th style={{ padding: "0.4rem" }}>Next attempt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.4rem" }}>
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                </td>
                <td style={{ padding: "0.4rem" }}>
                  <code>{row.status}</code>
                </td>
                <td style={{ padding: "0.4rem" }}>{row.vertical}</td>
                <td style={{ padding: "0.4rem" }}>{row.payload?.role ?? "—"}</td>
                <td style={{ padding: "0.4rem" }}>{row.attempts}</td>
                <td style={{ padding: "0.4rem", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {row.error ?? "—"}
                </td>
                <td style={{ padding: "0.4rem" }}>{new Date(row.created_at).toLocaleString()}</td>
                <td style={{ padding: "0.4rem" }}>{new Date(row.next_attempt_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
