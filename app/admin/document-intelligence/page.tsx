"use client";

import { Fragment, useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import AdminGate from "@/components/admin/AdminGate";

interface TemplateRow {
  id: string;
  documentType: string;
  vertical: string;
  owningModule: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  confidenceThreshold: number;
  requiresHumanReview: boolean;
  maxTokens: number;
  createdAt: string;
}

interface TemplateVersionRow {
  id: string;
  templateId: string | null;
  documentType: string;
  vertical: string;
  owningModule: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  confidenceThreshold: number;
  requiresHumanReview: boolean;
  maxTokens: number;
  versionedAt: string;
  versionedByLabel: string | null;
  changeReason: string | null;
}

const DEFAULT_MAX_TOKENS = "2048";

const DEFAULT_SCHEMA = '{\n  "type": "object",\n  "required": [],\n  "properties": {}\n}';

// Admin control plane for siringetbase.extraction_templates — see
// ../../../src/lib/document-intelligence/templates.ts's header comment for
// why this page exists: the table sat empty since it was created, so
// document uploads have been silently skipped rather than parsed,
// regardless of type. This page is where a business_admin registers a
// Llama prompt + JSON output schema for a document_type so uploads of that
// type actually get parsed instead of just stored.
//
// A (document_type, vertical) pair is unique — submitting the form again
// for a pair that already has a row replaces its prompt/schema, it doesn't
// create a duplicate (see the API route's upsertExtractionTemplate()).
//
// This is the piece a business_admin needs BEFORE releasing a new service
// type whose documents don't already have a registered template — see
// cafocus/app's /admin/service-types page, which links here and shows
// which document types are already covered.
export default function DocumentIntelligenceAdminPage() {
  return (
    <AdminGate allowedRoles={["business_admin"]}>
      {() => <DocumentIntelligenceAdminPageInner />}
    </AdminGate>
  );
}

function DocumentIntelligenceAdminPageInner() {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [documentType, setDocumentType] = useState("");
  const [vertical, setVertical] = useState("cafocus");
  const [owningModule, setOwningModule] = useState("");
  const [prompt, setPrompt] = useState("");
  const [outputSchema, setOutputSchema] = useState(DEFAULT_SCHEMA);
  const [confidenceThreshold, setConfidenceThreshold] = useState("0.8");
  const [requiresHumanReview, setRequiresHumanReview] = useState(true);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_MAX_TOKENS);
  const [changeReason, setChangeReason] = useState("");

  // Phase 3 of the ITR_gov_change agent's draft-apply link
  // (cafocus/app's /admin/itr-gov-alerts, an approved category:"form"
  // alert) — carried as query params rather than any cross-Worker POST, so
  // this stays a simple deep-link with nothing to authenticate beyond the
  // admin already signing in here normally. Read via window.location.search
  // in an effect, not next/navigation's useSearchParams(), same reasoning
  // cafocus/app's CaSignInForm.tsx gives: avoids forcing this page out of
  // static rendering / a <Suspense> boundary for a value that's only
  // needed after first paint, not before.
  //
  // Deliberately does NOT pre-fill prompt/outputSchema from the alert —
  // those need a human's real judgment about what the model should
  // actually be told to extract, not a government-notice summary poured
  // in verbatim (the whole point of the analysis doc's "no auto-apply"
  // guardrail). alertContext is shown as a banner instead, so the person
  // writing the real prompt has the source material in view without
  // having to keep a second tab open.
  const [alertContext, setAlertContext] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const documentTypeParam = params.get("document_type");
    const verticalParam = params.get("vertical");
    const contextParam = params.get("context");
    const alertIdParam = params.get("alert_id");

    if (documentTypeParam) setDocumentType(documentTypeParam);
    if (verticalParam) setVertical(verticalParam);
    if (contextParam) setAlertContext(contextParam);
    if (alertIdParam) setChangeReason(`Draft-applied from itr_gov_change_alerts ${alertIdParam}`);
  }, []);

  const [historyForId, setHistoryForId] = useState<string | null>(null);
  const [versions, setVersions] = useState<TemplateVersionRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/document-intelligence/extraction-templates");
    const body = (await res.json().catch(() => ({}))) as { status: string; rows?: TemplateRow[]; message?: string };
    if (body.status !== "ok") {
      setError(body.message ?? "Failed to load extraction templates.");
      setLoading(false);
      return;
    }
    setRows(body.rows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function editRow(row: TemplateRow) {
    setDocumentType(row.documentType);
    setVertical(row.vertical);
    setOwningModule(row.owningModule);
    setPrompt(row.prompt);
    setOutputSchema(JSON.stringify(row.outputSchema, null, 2));
    setConfidenceThreshold(String(row.confidenceThreshold));
    setRequiresHumanReview(row.requiresHumanReview);
    setMaxTokens(String(row.maxTokens));
    setInfo(`Editing "${row.documentType}" (${row.vertical}) — saving will replace this template's prompt/schema.`);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setInfo(null);

    const res = await fetch("/api/admin/document-intelligence/extraction-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document_type: documentType,
        vertical,
        owning_module: owningModule,
        prompt,
        output_schema: outputSchema,
        confidence_threshold: Number(confidenceThreshold),
        requires_human_review: requiresHumanReview,
        max_tokens: Number(maxTokens),
        change_reason: changeReason || undefined,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { status: string; message?: string };
    if (body.status !== "ok") {
      setError(body.message ?? "Could not save template.");
    } else {
      setInfo(`Template for "${documentType}" (${vertical}) saved — new uploads of this type will now be parsed.`);
      setDocumentType("");
      setOwningModule("");
      setPrompt("");
      setOutputSchema(DEFAULT_SCHEMA);
      setConfidenceThreshold("0.8");
      setRequiresHumanReview(true);
      setMaxTokens(DEFAULT_MAX_TOKENS);
      setChangeReason("");
      setAlertContext(null);
    }
    setSaving(false);
    await load();
  }

  // Toggles the version-history panel for a row — fetched on demand
  // (not preloaded for every row on page load) since most templates will
  // never be looked at again after their first save.
  async function toggleHistory(templateId: string) {
    if (historyForId === templateId) {
      setHistoryForId(null);
      setVersions([]);
      return;
    }
    setHistoryForId(templateId);
    setHistoryLoading(true);
    setVersions([]);
    const res = await fetch(`/api/admin/document-intelligence/extraction-templates/${templateId}/versions`);
    const body = (await res.json().catch(() => ({}))) as { status: string; rows?: TemplateVersionRow[]; message?: string };
    if (body.status === "ok") {
      setVersions(body.rows ?? []);
    } else {
      setError(body.message ?? "Could not load version history.");
    }
    setHistoryLoading(false);
  }

  // The actual recovery action — restores a past version as the live row.
  // Per explicit instruction, this is a one-click write, not just a
  // read-only history view.
  async function restoreVersion(version: TemplateVersionRow) {
    setRestoringId(version.id);
    setError(null);
    setInfo(null);
    const res = await fetch(`/api/admin/document-intelligence/extraction-templates/versions/${version.id}/restore`, {
      method: "POST",
    });
    const body = (await res.json().catch(() => ({}))) as { status: string; id?: string; message?: string };
    if (body.status !== "ok") {
      setError(body.message ?? "Could not restore this version.");
    } else {
      setInfo(`Restored "${version.documentType}" (${version.vertical}) to its ${new Date(version.versionedAt).toLocaleString()} version.`);
      // The restore itself snapshotted the row it just replaced, so the
      // history list has a new entry too — re-fetch directly (by the
      // live template's id, which the restore response returns) rather
      // than the toggle-off/toggle-on dance, which would double-fire if
      // called twice in a row.
      if (body.id) {
        setHistoryForId(body.id);
        setHistoryLoading(true);
        const historyRes = await fetch(`/api/admin/document-intelligence/extraction-templates/${body.id}/versions`);
        const historyBody = (await historyRes.json().catch(() => ({}))) as { status: string; rows?: TemplateVersionRow[] };
        if (historyBody.status === "ok") setVersions(historyBody.rows ?? []);
        setHistoryLoading(false);
      }
    }
    setRestoringId(null);
    await load();
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 960 }}>
      <h1>Document intelligence — extraction templates</h1>
      <p>
        A document is only parsed by the AI model if a template is registered here for its exact{" "}
        <code>document_type</code> + <code>vertical</code>. Without one, upload still works — the document is just
        stored, never read. Every template here should have <code>requires_human_review</code> on unless you&apos;re
        confident enough in a document type to skip a CA&apos;s review of what the model extracted.
      </p>
      <p>
        <strong>Max output tokens</strong> caps how long the model&apos;s response can get before it&apos;s cut off.
        Set it too low for a document type whose schema can produce a lot of output (an open-ended array, especially
        — this is exactly what happened to AIS: its <code>entries</code> array is unbounded, unlike every other
        template&apos;s fixed handful of fields) and the response gets truncated mid-JSON, which then fails to parse
        even after cleanup — surfaces to the person reviewing it as &ldquo;Model output wasn&apos;t valid
        JSON.&rdquo; Kept per-template rather than one global setting, since output size is really a property of the
        document type&apos;s schema, not the pipeline. It&apos;s also deliberately provider-agnostic — see{" "}
        <code>src/lib/document-intelligence/model-gateway.ts</code>&apos;s header comment — so this value still means
        the same thing if a second AI provider is ever wired in alongside Workers AI; only the exact token count
        would need retuning per provider, since tokenizers differ.
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {info && <p style={{ color: "seagreen" }}>{info}</p>}

      {alertContext && (
        <div style={{ border: "1px solid #f0c36d", background: "#fff8e6", borderRadius: 8, padding: "0.9rem 1rem", margin: "1rem 0" }}>
          <p style={{ margin: "0 0 0.4rem", fontWeight: 600 }}>
            Draft-apply context from an approved ITR gov-change alert
          </p>
          <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.9rem" }}>{alertContext}</p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem", color: "#7a5c00" }}>
            This is the alert&apos;s own summary/excerpt, shown for context only — the prompt and output schema below
            still need your own judgment about what the model should actually extract, not a copy of this text.
          </p>
        </div>
      )}

      <h2>Add or replace a template</h2>
      <form onSubmit={(e) => void handleSave(e)} style={formStyle}>
        <label>
          Document type
          <input
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            placeholder="e.g. form16, tds_challan"
            style={inputStyle}
          />
        </label>
        <label>
          Vertical
          <input value={vertical} onChange={(e) => setVertical(e.target.value)} style={inputStyle} />
        </label>
        <label>
          Owning module
          <input
            value={owningModule}
            onChange={(e) => setOwningModule(e.target.value)}
            placeholder="e.g. cafocus/individual"
            style={inputStyle}
          />
        </label>
        <label>
          Confidence threshold
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={confidenceThreshold}
            onChange={(e) => setConfidenceThreshold(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          Max output tokens{" "}
          <span style={{ fontWeight: 400, color: "#666" }} title="How much of a response the model is allowed to generate before it gets cut off. Too low silently truncates the response mid-JSON, which then fails to parse — this is what happened to a real AIS extraction (its 'entries' array is open-ended, unlike every other template's fixed handful of fields). Workers AI's own default is 256, which is why this exists at all.">
            (?)
          </span>
          <input
            type="number"
            min="256"
            max="32000"
            step="256"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", gridColumn: "1 / -1" }}>
          <input
            type="checkbox"
            checked={requiresHumanReview}
            onChange={(e) => setRequiresHumanReview(e.target.checked)}
          />
          Requires human (CA) review before the extracted data is trusted
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Prompt <span style={{ fontWeight: 400, color: "#666" }}>(instructions to the vision model)</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            style={{ ...inputStyle, fontFamily: "inherit" }}
          />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Output schema <span style={{ fontWeight: 400, color: "#666" }}>(JSON — the shape the model must return)</span>
          <textarea
            value={outputSchema}
            onChange={(e) => setOutputSchema(e.target.value)}
            rows={8}
            style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.85rem" }}
          />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Change reason{" "}
          <span style={{ fontWeight: 400, color: "#666" }}>
            (optional — recorded on this edit&apos;s version snapshot, e.g. why this replaced the previous prompt)
          </span>
          <input
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            placeholder="e.g. Draft-applied from itr_gov_change_alerts <id>"
            style={inputStyle}
          />
        </label>
        <button type="submit" disabled={saving} style={{ gridColumn: "1 / -1", justifySelf: "start" }}>
          {saving ? "Saving…" : "Save template"}
        </button>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No extraction templates registered yet — every document upload is being stored but not parsed.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Document type</th>
              <th style={cellStyle}>Vertical</th>
              <th style={cellStyle}>Owning module</th>
              <th style={cellStyle}>Confidence threshold</th>
              <th style={cellStyle}>Max tokens</th>
              <th style={cellStyle}>Human review</th>
              <th style={cellStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td style={cellStyle}>{r.documentType}</td>
                  <td style={cellStyle}>{r.vertical}</td>
                  <td style={cellStyle}>{r.owningModule}</td>
                  <td style={cellStyle}>{r.confidenceThreshold}</td>
                  <td style={cellStyle}>{r.maxTokens}</td>
                  <td style={cellStyle}>{r.requiresHumanReview ? "Required" : "Not required"}</td>
                  <td style={cellStyle}>
                    <button type="button" onClick={() => editRow(r)}>
                      Edit
                    </button>{" "}
                    <button type="button" onClick={() => void toggleHistory(r.id)}>
                      {historyForId === r.id ? "Hide history" : "History"}
                    </button>
                  </td>
                </tr>
                {historyForId === r.id && (
                  <tr>
                    <td colSpan={7} style={{ ...cellStyle, background: "#fafafa" }}>
                      {historyLoading ? (
                        <p style={{ margin: 0 }}>Loading version history…</p>
                      ) : versions.length === 0 ? (
                        <p style={{ margin: 0, color: "#666" }}>
                          No prior versions — this template has never been overwritten since it was first saved.
                        </p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                          <p style={{ margin: 0, fontSize: "0.85rem", color: "#666" }}>
                            {versions.length} prior version{versions.length === 1 ? "" : "s"} — &ldquo;Recover&rdquo;
                            restores that version as the live template (and snapshots what it replaces, so this is
                            always undoable too).
                          </p>
                          {versions.map((v) => (
                            <div
                              key={v.id}
                              style={{
                                border: "1px solid #ddd",
                                borderRadius: 6,
                                padding: "0.6rem 0.75rem",
                                background: "white",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "flex-start",
                                gap: "1rem",
                              }}
                            >
                              <div style={{ fontSize: "0.85rem" }}>
                                <div>
                                  <strong>{new Date(v.versionedAt).toLocaleString()}</strong>
                                  {v.versionedByLabel && <> — by {v.versionedByLabel}</>}
                                </div>
                                {v.changeReason && <div style={{ color: "#666" }}>{v.changeReason}</div>}
                                <div style={{ color: "#666" }}>
                                  confidence {v.confidenceThreshold}, max tokens {v.maxTokens},{" "}
                                  {v.requiresHumanReview ? "human review required" : "no human review required"}
                                </div>
                              </div>
                              <button type="button" disabled={restoringId === v.id} onClick={() => void restoreVersion(v)}>
                                {restoringId === v.id ? "Recovering…" : "Recover this version"}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

const formStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "0.75rem",
  alignItems: "start",
  margin: "1rem 0 1.5rem",
  padding: "1rem",
  border: "1px solid #ddd",
  borderRadius: 8,
};
const inputStyle: CSSProperties = { display: "block", width: "100%", padding: "0.4rem", marginTop: "0.25rem" };
const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" };
const cellStyle: CSSProperties = { border: "1px solid #ddd", padding: "0.4rem", textAlign: "left" };
