-- Phase 3 of the ITR_gov_change agent
-- (../../../cafocus/phases/itr-gov-change-agent-analysis.md) added a
-- draft-apply path from an approved form-category alert into
-- siringetbase.extraction_templates (see ./templates.ts). Per explicit
-- instruction, before ANY write ever overwrites a live extraction_templates
-- row — draft-apply or a plain manual edit via the existing admin form,
-- doesn't matter which — the row's prior state must be snapshotted here
-- first. This is a hard prerequisite, not specific to the draft-apply
-- feature: a working template must never be silently replaced without a
-- recoverable copy existing first.
--
-- One row per historical version of a given template (insert-only, never
-- updated) — NOT an update-in-place "previous value" column on
-- extraction_templates itself, so a template's full history survives
-- multiple edits, not just the single most recent one.
--
-- template_id references extraction_templates(id) but does NOT cascade
-- delete — if a template row is ever hard-deleted (nothing in this
-- codebase does that today; upsertExtractionTemplate() only ever
-- inserts/updates), its version history should still be inspectable for
-- audit purposes. on delete set null makes that explicit rather than
-- accidental.
--
-- Idempotent — safe to re-run.

create table if not exists siringetbase.extraction_templates_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references siringetbase.extraction_templates(id) on delete set null,

  -- Full snapshot of the row's state at versioning time — same columns as
  -- extraction_templates itself (this migration's own comment on that
  -- table, plus 0021/0023's additions). document_type/vertical are
  -- duplicated here (not just template_id) so a version stays readable
  -- and attributable even if template_id is ever null'd out.
  document_type text not null,
  vertical text not null,
  owning_module text not null,
  prompt text not null,
  output_schema jsonb not null,
  confidence_threshold numeric(3, 2) not null,
  requires_human_review boolean not null,
  max_tokens integer not null,

  -- When this snapshot was taken (i.e. right before the row it captures
  -- got overwritten) and by whom — an admin_audit_log-style actor
  -- reference, not a hard FK, same posture as itr_gov_change_alerts'
  -- reviewed_by (a siringetbase role_profiles id, nullable since a
  -- system-triggered version — none exist yet, but the column allows for
  -- one later — has no human actor).
  versioned_at timestamptz not null default now(),
  versioned_by uuid references siringetbase.role_profiles(id),

  -- Free-text context for why this version was superseded — e.g. "draft-
  -- apply from cafocus.itr_gov_change_alerts <id>" vs "manual edit via
  -- /admin/document-intelligence". Nullable — a version created before
  -- this field had meaning, or a manual edit with no extra context, is
  -- still a valid, restorable version without one.
  change_reason text,

  created_at timestamptz not null default now()
);

create index if not exists extraction_templates_versions_template_id_idx
  on siringetbase.extraction_templates_versions(template_id);
create index if not exists extraction_templates_versions_versioned_at_idx
  on siringetbase.extraction_templates_versions(template_id, versioned_at desc);

comment on table siringetbase.extraction_templates_versions is
  'Snapshot of siringetbase.extraction_templates taken immediately before every overwrite (see ./templates.ts''s upsertExtractionTemplate()) — lets an admin recover the last working version of a template after a bad edit or a bad draft-apply. Insert-only; never updated or pruned automatically.';

alter table siringetbase.extraction_templates_versions enable row level security;

-- Same posture as extraction_templates itself and every other admin-only
-- control-plane table in this codebase (rate cards, subscription plans):
-- service-role + app-code-enforced (requireAdmin() in the API routes),
-- RLS as defense-in-depth. No authenticated grant — this is an internal
-- audit/rollback trail, not something any signed-in user should read
-- directly the way extraction_templates itself (a registry) is.
grant all on siringetbase.extraction_templates_versions to service_role;
