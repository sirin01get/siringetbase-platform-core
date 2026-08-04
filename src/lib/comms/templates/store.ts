// Admin control plane for siringetbase.comms_templates (see
// ../../../../supabase/migrations/0036_comms_templates.sql's header comment
// for why this exists). Same shape as
// ../../document-intelligence/templates.ts, adapted for email copy instead
// of extraction prompts: list/upsert with snapshot-before-write versioning,
// list/restore version history, plus renderCommsTemplate() — the plain
// {{placeholder}} substitution a DB row uses instead of a compiled
// TypeScript function's full conditional logic (comms/README.md's Rollout
// Plan step 6: "a DB row is just a swappable string carrying the same
// tokens, not a new templating language").

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { RenderedEmail } from "../types";
import { escapeHtml } from "./shared";

export interface CommsTemplateRow {
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

export async function listCommsTemplates(vertical?: string): Promise<CommsTemplateRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  let query = supabase
    .from("comms_templates")
    .select("id, vertical, role, trigger_event, subject, body_html, body_text, created_at, updated_at")
    .order("vertical", { ascending: true })
    .order("role", { ascending: true })
    .order("trigger_event", { ascending: true });
  if (vertical) query = query.eq("vertical", vertical);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    vertical: r.vertical,
    role: r.role,
    triggerEvent: r.trigger_event,
    subject: r.subject,
    bodyHtml: r.body_html,
    bodyText: r.body_text,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// The hot-path read — used by ../registry.ts's getTemplate() on every send
// to check whether this exact (vertical, role, triggerEvent) has a
// business-admin override before falling back to the compiled-in renderer.
// Returns null (not throw) on "no row" — that's the expected, common case,
// not an error. Callers that hit a real DB error should decide for
// themselves whether to fail the send or fall back to compiled copy; see
// registry.ts's try/catch around this call for why it chooses the latter.
export async function getCommsTemplate(vertical: string, role: string, triggerEvent: string): Promise<CommsTemplateRow | null> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("comms_templates")
    .select("id, vertical, role, trigger_event, subject, body_html, body_text, created_at, updated_at")
    .eq("vertical", vertical)
    .eq("role", role)
    .eq("trigger_event", triggerEvent)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: data.id,
    vertical: data.vertical,
    role: data.role,
    triggerEvent: data.trigger_event,
    subject: data.subject,
    bodyHtml: data.body_html,
    bodyText: data.body_text,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

// Upsert on (vertical, role, trigger_event) — the table's own unique
// constraint (comms_templates_vertical_role_trigger_unique) means there can
// only ever be one override per registry entry, so re-submitting the same
// triple from the admin UI is a deliberate "replace this copy" edit, not an
// error. Same snapshot-before-overwrite prerequisite as
// document-intelligence's upsertExtractionTemplate(): before this ever
// overwrites an EXISTING row, that row's prior state is snapshotted into
// comms_templates_versions first, unconditionally. A brand-new triple has
// nothing to snapshot, since there's no prior row to lose.
export async function upsertCommsTemplate(params: {
  vertical: string;
  role: string;
  triggerEvent: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  versionedByRoleProfileId?: string | null;
  changeReason?: string | null;
}): Promise<{ id: string }> {
  const supabase = createSupabaseServiceRoleClient();

  const { data: existing } = await supabase
    .from("comms_templates")
    .select("id, vertical, role, trigger_event, subject, body_html, body_text")
    .eq("vertical", params.vertical)
    .eq("role", params.role)
    .eq("trigger_event", params.triggerEvent)
    .maybeSingle();

  if (existing) {
    const { error: versionError } = await supabase.from("comms_templates_versions").insert({
      template_id: existing.id,
      vertical: existing.vertical,
      role: existing.role,
      trigger_event: existing.trigger_event,
      subject: existing.subject,
      body_html: existing.body_html,
      body_text: existing.body_text,
      versioned_by: params.versionedByRoleProfileId ?? null,
      change_reason: params.changeReason ?? null,
    });
    // A snapshot failure must block the overwrite, not just get logged —
    // same non-negotiable as extraction_templates: a template is never
    // replaced without a recoverable copy existing first.
    if (versionError) {
      throw new Error(`Could not snapshot existing template before saving over it: ${versionError.message}`);
    }
  }

  const { data, error } = await supabase
    .from("comms_templates")
    .upsert(
      {
        vertical: params.vertical,
        role: params.role,
        trigger_event: params.triggerEvent,
        subject: params.subject,
        body_html: params.bodyHtml,
        body_text: params.bodyText,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "vertical,role,trigger_event" }
    )
    .select("id")
    .single();

  if (error || !data) throw new Error(`Could not save comms template: ${error?.message ?? "unknown error"}`);
  return { id: data.id };
}

// Deletes the DB override, reverting this (vertical, role, triggerEvent)
// back to the compiled-in renderer — the row's prior state is snapshotted
// first, same as any other overwrite, so "revert to code default" is
// itself recoverable via version history.
export async function deleteCommsTemplate(
  id: string,
  actor: { versionedByRoleProfileId?: string | null; changeReason?: string | null }
): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();
  const { data: existing, error: fetchError } = await supabase
    .from("comms_templates")
    .select("id, vertical, role, trigger_event, subject, body_html, body_text")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!existing) return;

  const { error: versionError } = await supabase.from("comms_templates_versions").insert({
    template_id: existing.id,
    vertical: existing.vertical,
    role: existing.role,
    trigger_event: existing.trigger_event,
    subject: existing.subject,
    body_html: existing.body_html,
    body_text: existing.body_text,
    versioned_by: actor.versionedByRoleProfileId ?? null,
    change_reason: actor.changeReason ?? "Deleted — reverted to compiled-in default",
  });
  if (versionError) {
    throw new Error(`Could not snapshot template before deleting it: ${versionError.message}`);
  }

  const { error: deleteError } = await supabase.from("comms_templates").delete().eq("id", id);
  if (deleteError) throw new Error(deleteError.message);
}

export interface CommsTemplateVersionRow {
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

export async function listCommsTemplateVersions(templateId: string): Promise<CommsTemplateVersionRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("comms_templates_versions")
    .select("id, template_id, vertical, role, trigger_event, subject, body_html, body_text, versioned_at, versioned_by, change_reason")
    .eq("template_id", templateId)
    .order("versioned_at", { ascending: false });

  if (error) throw new Error(error.message);

  // Same per-row role_profile -> auth.admin.getUserById() lookup as
  // document-intelligence/templates.ts's listTemplateVersions() uses for
  // the same "show a human-readable reviewer, not a bare uuid" reason.
  const out: CommsTemplateVersionRow[] = [];
  for (const row of data ?? []) {
    let versionedByLabel: string | null = null;
    if (row.versioned_by) {
      const { data: roleProfile } = await supabase.from("role_profiles").select("user_id").eq("id", row.versioned_by).maybeSingle();
      if (roleProfile?.user_id) {
        const { data: userData } = await supabase.auth.admin.getUserById(roleProfile.user_id);
        versionedByLabel = userData.user?.email ?? "admin";
      }
    }
    out.push({
      id: row.id,
      templateId: row.template_id,
      vertical: row.vertical,
      role: row.role,
      triggerEvent: row.trigger_event,
      subject: row.subject,
      bodyHtml: row.body_html,
      bodyText: row.body_text,
      versionedAt: row.versioned_at,
      versionedByLabel,
      changeReason: row.change_reason,
    });
  }
  return out;
}

// Recovers a past version as the live row — goes through
// upsertCommsTemplate() itself so restoring is exactly as safe as any other
// edit: the row being REPLACED by this restore is itself snapshotted first,
// so a bad restore is always undoable too.
export async function restoreCommsTemplateVersion(
  versionId: string,
  actor: { versionedByRoleProfileId?: string | null }
): Promise<{ id: string }> {
  const supabase = createSupabaseServiceRoleClient();
  const { data: version, error } = await supabase
    .from("comms_templates_versions")
    .select("vertical, role, trigger_event, subject, body_html, body_text")
    .eq("id", versionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!version) throw new Error(`No version found with id ${versionId}.`);

  return upsertCommsTemplate({
    vertical: version.vertical,
    role: version.role,
    triggerEvent: version.trigger_event,
    subject: version.subject,
    bodyHtml: version.body_html,
    bodyText: version.body_text,
    versionedByRoleProfileId: actor.versionedByRoleProfileId,
    changeReason: `Restored from version ${versionId}`,
  });
}

// Plain {{key}} substitution — not a new templating language, deliberately
// no conditionals/loops (comms/README.md's Rollout Plan step 6). A missing
// key in templateData substitutes as an empty string rather than leaving
// the literal "{{key}}" in the sent email. body_html gets each value
// HTML-escaped (same discipline ../shared.ts's escapeHtml() enforces for
// every compiled template); subject/body_text substitute the raw string —
// they're plain text, never interpreted as HTML.
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function substitute(template: string, data: Record<string, unknown>, escape: boolean): string {
  return template.replace(PLACEHOLDER_RE, (_match, key: string) => {
    const value = data[key];
    const str = value == null ? "" : String(value);
    return escape ? escapeHtml(str) : str;
  });
}

export function renderCommsTemplate(row: Pick<CommsTemplateRow, "subject" | "bodyHtml" | "bodyText">, data: Record<string, unknown>): RenderedEmail {
  return {
    subject: substitute(row.subject, data, false),
    html: substitute(row.bodyHtml, data, true),
    text: substitute(row.bodyText, data, false),
  };
}
