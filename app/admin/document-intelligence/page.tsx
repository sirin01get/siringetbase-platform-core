"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
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
  createdAt: string;
}

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
    }
    setSaving(false);
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

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {info && <p style={{ color: "seagreen" }}>{info}</p>}

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
              <th style={cellStyle}>Human review</th>
              <th style={cellStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={cellStyle}>{r.documentType}</td>
                <td style={cellStyle}>{r.vertical}</td>
                <td style={cellStyle}>{r.owningModule}</td>
                <td style={cellStyle}>{r.confidenceThreshold}</td>
                <td style={cellStyle}>{r.requiresHumanReview ? "Required" : "Not required"}</td>
                <td style={cellStyle}>
                  <button type="button" onClick={() => editRow(r)}>
                    Edit
                  </button>
                </td>
              </tr>
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
