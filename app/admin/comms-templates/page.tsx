"use client";

import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import AdminGate from "@/components/admin/AdminGate";
import {
  Badge,
  Banner,
  buttonPrimary,
  buttonSecondary,
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

interface TemplateRow {
  id: string;
  vertical: string;
  role: string;
  triggerEvent: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  createdAt: string;
  updatedAt: string;
}

interface TemplateVersionRow {
  id: string;
  templateId: string | null;
  vertical: string;
  role: string;
  triggerEvent: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  versionedAt: string;
  versionedByLabel: string | null;
  changeReason: string | null;
}

// Admin control plane for siringetbase.comms_templates — see
// ../../../src/lib/comms/templates/store.ts's header comment and
// ../../../supabase/migrations/0036_comms_templates.sql for why this page
// exists: every email's copy has always been a compiled TypeScript
// function (src/lib/comms/templates/ca.ts, fallback.ts) — changing a
// subject line or a sentence meant a code change and a full redeploy. An
// override saved here for one exact (vertical, role, trigger_event) takes
// effect on the very next send with no redeploy — src/lib/comms/templates/
// registry.ts's getTemplate() checks this table before the compiled-in
// copy. No override saved means that triggerEvent keeps sending its
// compiled-in copy exactly as it always has.
//
// {{placeholder}} tokens in subject/body_html/body_text must match the
// exact keys the compiled renderer for that triggerEvent already expects
// (see e.g. src/lib/comms/templates/ca.ts's referralCaClientInvite() for
// what {{firmName}}, {{serviceTypeDisplayName}} etc. look like in
// practice) — this form does plain string substitution, not a new
// templating language, so an unknown or misspelled token is left in the
// sent email as literal text.
//
// Deliberately plain-text inputs for vertical/role/trigger_event (free
// text, not a dropdown sourced from the registry) — same posture as
// ../document-intelligence/page.tsx's document_type field: this page is
// the tool an admin uses to override an existing registry entry, and the
// exact triple has to match what a real send actually requests (see
// registry.ts's REGISTRY constant and each templates/*.ts file's own
// exports for the full list of what's registered today).
export default function CommsTemplatesAdminPage() {
  return (
    <AdminGate allowedRoles={["business_admin"]}>
      {() => <CommsTemplatesAdminPageInner />}
    </AdminGate>
  );
}

function CommsTemplatesAdminPageInner() {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [vertical, setVertical] = useState("cafocus");
  const [role, setRole] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [changeReason, setChangeReason] = useState("");

  const [historyForId, setHistoryForId] = useState<string | null>(null);
  const [versions, setVersions] = useState<TemplateVersionRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/comms-templates");
    const body = (await res.json().catch(() => ({}))) as { status: string; rows?: TemplateRow[]; message?: string };
    if (body.status !== "ok") {
      setError(body.message ?? "Failed to load comms templates.");
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
    setVertical(row.vertical);
    setRole(row.role);
    setTriggerEvent(row.triggerEvent);
    setSubject(row.subject);
    setBodyHtml(row.bodyHtml);
    setBodyText(row.bodyText);
    setInfo(`Editing "${row.vertical}/${row.role}/${row.triggerEvent}" — saving will replace this template's copy.`);
  }

  function resetForm() {
    setVertical("cafocus");
    setRole("");
    setTriggerEvent("");
    setSubject("");
    setBodyHtml("");
    setBodyText("");
    setChangeReason("");
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setInfo(null);

    const res = await fetch("/api/admin/comms-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vertical,
        role,
        trigger_event: triggerEvent,
        subject,
        body_html: bodyHtml,
        body_text: bodyText,
        change_reason: changeReason || undefined,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { status: string; message?: string };
    if (body.status !== "ok") {
      setError(body.message ?? "Could not save template.");
    } else {
      setInfo(`Override for "${vertical}/${role}/${triggerEvent}" saved — the next send of this triggerEvent uses this copy.`);
      resetForm();
    }
    setSaving(false);
    await load();
  }

  async function handleDelete(row: TemplateRow) {
    if (!window.confirm(`Revert "${row.vertical}/${row.role}/${row.triggerEvent}" back to its compiled-in default copy?`)) return;
    setDeletingId(row.id);
    setError(null);
    setInfo(null);
    const res = await fetch(`/api/admin/comms-templates/${row.id}`, { method: "DELETE" });
    const body = (await res.json().catch(() => ({}))) as { status: string; message?: string };
    if (body.status !== "ok") {
      setError(body.message ?? "Could not revert this template.");
    } else {
      setInfo(`Reverted "${row.vertical}/${row.role}/${row.triggerEvent}" to its compiled-in default.`);
    }
    setDeletingId(null);
    await load();
  }

  async function toggleHistory(templateId: string) {
    if (historyForId === templateId) {
      setHistoryForId(null);
      setVersions([]);
      return;
    }
    setHistoryForId(templateId);
    setHistoryLoading(true);
    setVersions([]);
    const res = await fetch(`/api/admin/comms-templates/${templateId}/versions`);
    const body = (await res.json().catch(() => ({}))) as { status: string; rows?: TemplateVersionRow[]; message?: string };
    if (body.status === "ok") {
      setVersions(body.rows ?? []);
    } else {
      setError(body.message ?? "Could not load version history.");
    }
    setHistoryLoading(false);
  }

  async function restoreVersion(version: TemplateVersionRow) {
    setRestoringId(version.id);
    setError(null);
    setInfo(null);
    const res = await fetch(`/api/admin/comms-templates/versions/${version.id}/restore`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { status: string; id?: string; message?: string };
    if (body.status !== "ok") {
      setError(body.message ?? "Could not restore this version.");
    } else {
      setInfo(`Restored "${version.vertical}/${version.role}/${version.triggerEvent}" to its ${new Date(version.versionedAt).toLocaleString()} version.`);
      if (body.id) {
        setHistoryForId(body.id);
        setHistoryLoading(true);
        const historyRes = await fetch(`/api/admin/comms-templates/${body.id}/versions`);
        const historyBody = (await historyRes.json().catch(() => ({}))) as { status: string; rows?: TemplateVersionRow[] };
        if (historyBody.status === "ok") setVersions(historyBody.rows ?? []);
        setHistoryLoading(false);
      }
    }
    setRestoringId(null);
    await load();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Comms — email template overrides"
        description={
          <>
            <p>
              Every email&apos;s copy is a compiled function in{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]">
                platform-core/src/lib/comms/templates/*.ts
              </code>{" "}
              unless a row exists here for its exact vertical + role + trigger event. Saving an override here takes
              effect on the very next send — no redeploy needed. Deleting an override reverts that triggerEvent back
              to its compiled-in copy.
            </p>
            <p className="mt-2">
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]">{"{{placeholder}}"}</code> tokens must
              match what the compiled renderer for that trigger event already uses (e.g.{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]">{"{{firmName}}"}</code>) — this is
              plain text substitution, not a new templating language, so an unrecognized token is left as literal
              text in the sent email.
            </p>
          </>
        }
      />

      {error && <Banner tone="red" className="mb-5">{error}</Banner>}
      {info && <Banner tone="green" className="mb-5">{info}</Banner>}

      <SectionHeading className="mb-3">Add or replace an override</SectionHeading>
      <Card className="mb-8 p-5">
        <form onSubmit={(e) => void handleSave(e)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Vertical
            <input value={vertical} onChange={(e) => setVertical(e.target.value)} className={`${inputClass} mt-1.5`} />
          </label>
          <label className={labelClass}>
            Role
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. ca, individual, smb_owner"
              className={`${inputClass} mt-1.5`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Trigger event
            <input
              value={triggerEvent}
              onChange={(e) => setTriggerEvent(e.target.value)}
              placeholder="e.g. referral.ca_client_invite, verification.approved"
              className={`${inputClass} mt-1.5`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={`${inputClass} mt-1.5`} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Body HTML{" "}
            <span className={hintClass}>(full HTML sent as the email body — include your own layout/styling)</span>
            <textarea
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              rows={10}
              className={`${inputClass} mt-1.5 font-mono text-[0.85em]`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Body text <span className={hintClass}>(plain-text fallback for clients that don&apos;t render HTML)</span>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={5}
              className={`${inputClass} mt-1.5 font-mono text-[0.85em]`}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Change reason <span className={hintClass}>(optional — recorded on this edit&apos;s version snapshot)</span>
            <input
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder="e.g. Softened the subject line per support feedback"
              className={`${inputClass} mt-1.5`}
            />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={saving} className={buttonPrimary}>
              {saving ? (
                <span className="flex items-center gap-2">
                  <Spinner /> Saving…
                </span>
              ) : (
                "Save override"
              )}
            </button>
            <button type="button" onClick={resetForm} className={buttonSecondary}>
              Clear form
            </button>
          </div>
        </form>
      </Card>

      {loading ? (
        <EmptyState>Loading…</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>No overrides saved yet — every template is sending its compiled-in default copy.</EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className={th}>Vertical</th>
                  <th className={th}>Role</th>
                  <th className={th}>Trigger event</th>
                  <th className={th}>Subject</th>
                  <th className={th}>Updated</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className={trBody}>
                      <td className={td}>
                        <Badge tone="slate">{r.vertical}</Badge>
                      </td>
                      <td className={td}>{r.role}</td>
                      <td className={`${td} font-medium text-slate-900`}>{r.triggerEvent}</td>
                      <td className={`${td} text-slate-500`}>{r.subject}</td>
                      <td className={`${td} text-slate-500`}>{new Date(r.updatedAt).toLocaleString()}</td>
                      <td className={td}>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => editRow(r)} className={buttonSecondary}>
                            Edit
                          </button>
                          <button type="button" onClick={() => void toggleHistory(r.id)} className={buttonSecondary}>
                            {historyForId === r.id ? "Hide history" : "History"}
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === r.id}
                            onClick={() => void handleDelete(r)}
                            className={buttonSecondary}
                          >
                            {deletingId === r.id ? "Reverting…" : "Revert to default"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {historyForId === r.id && (
                      <tr>
                        <td colSpan={6} className="bg-slate-50/70 px-4 py-4">
                          {historyLoading ? (
                            <p className="flex items-center gap-2 text-sm text-slate-500">
                              <Spinner /> Loading version history…
                            </p>
                          ) : versions.length === 0 ? (
                            <p className="text-sm text-slate-500">
                              No prior versions — this override has never been overwritten since it was first saved.
                            </p>
                          ) : (
                            <div className="flex flex-col gap-2.5">
                              <p className="text-sm text-slate-500">
                                {versions.length} prior version{versions.length === 1 ? "" : "s"} —
                                &ldquo;Recover&rdquo; restores that version as the live override (and snapshots what
                                it replaces, so this is always undoable too).
                              </p>
                              {versions.map((v) => (
                                <div
                                  key={v.id}
                                  className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5"
                                >
                                  <div className="text-sm">
                                    <div>
                                      <strong className="font-semibold text-slate-900">
                                        {new Date(v.versionedAt).toLocaleString()}
                                      </strong>
                                      {v.versionedByLabel && <span className="text-slate-500"> — by {v.versionedByLabel}</span>}
                                    </div>
                                    {v.changeReason && <div className="text-slate-500">{v.changeReason}</div>}
                                    <div className="text-slate-500">{v.subject}</div>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={restoringId === v.id}
                                    onClick={() => void restoreVersion(v)}
                                    className={buttonSecondary}
                                  >
                                    {restoringId === v.id ? (
                                      <span className="flex items-center gap-2">
                                        <Spinner /> Recovering…
                                      </span>
                                    ) : (
                                      "Recover this version"
                                    )}
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
          </div>
        </Card>
      )}
    </main>
  );
}
