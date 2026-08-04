-- Business-admin-editable email copy — closes the gap flagged in
-- ../../comms/README.md's Rollout Plan step 6: every template today is a
-- compiled TypeScript function (src/lib/comms/templates/ca.ts, fallback.ts,
-- support.ts), so changing a subject line or a sentence has always
-- required a code change and a full platform-core redeploy. This is the
-- exact same gap document-intelligence's extraction_templates closed for
-- AI prompts (0021_extraction_templates_seed.sql's header comment) — same
-- table shape, same versioning discipline, same admin-control-plane
-- posture, mirrored here for comms.
--
-- A row is an OVERRIDE for one exact (vertical, role, trigger_event)
-- registry entry (see src/lib/comms/templates/registry.ts's lookup order)
-- — not a new templating language. subject/body_html/body_text carry the
-- same {{placeholder}} tokens the compiled renderer for that triggerEvent
-- already defines (e.g. {{firmName}}, {{serviceTypeDisplayName}}); see
-- src/lib/comms/templates/store.ts's renderCommsTemplate() for the plain
-- substitution logic. No row here means getTemplate() falls straight
-- through to the compiled-in function exactly as it always has — a
-- template can never end up missing just because an admin hasn't touched
-- it yet.
--
-- Deliberately scoped to the exact-match (vertical, role, trigger_event)
-- tier only, matching REGISTRY[vertical][role][triggerEvent] in
-- registry.ts — not the INTERNAL_TEMPLATES tier (support.* — staff-
-- facing, not vertical-branded, no business_admin copy need) and not the
-- FALLBACK_TEMPLATES tier (role-agnostic stub copy shared across not-yet-
-- built roles, not really "this vertical's copy" to hand to an admin
-- yet). Both can be brought into this table later by widening
-- registry.ts's DB lookup — nothing here forecloses that, it's just not
-- today's ask.
--
-- Idempotent — safe to re-run.

create table if not exists siringetbase.comms_templates (
  id uuid primary key default gen_random_uuid(),
  vertical text not null,
  role text not null,
  trigger_event text not null,
  subject text not null,
  body_html text not null,
  body_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comms_templates_vertical_role_trigger_unique unique (vertical, role, trigger_event)
);

create index if not exists comms_templates_lookup_idx
  on siringetbase.comms_templates(vertical, role, trigger_event);

comment on table siringetbase.comms_templates is
  'Business-admin-editable override for one (vertical, role, trigger_event) email template — see src/lib/comms/templates/registry.ts''s getTemplate() for the DB-first, compiled-fallback lookup order this table participates in.';

-- Same snapshot-before-write versioning discipline as
-- extraction_templates_versions (0024_extraction_templates_versions.sql's
-- header comment) — before ANY write ever overwrites a live comms_templates
-- row, the row's prior state is snapshotted here first. One row per
-- historical version (insert-only, never updated), so a template's full
-- edit history survives multiple edits, not just the single most recent
-- one.
create table if not exists siringetbase.comms_templates_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references siringetbase.comms_templates(id) on delete set null,

  vertical text not null,
  role text not null,
  trigger_event text not null,
  subject text not null,
  body_html text not null,
  body_text text not null,

  versioned_at timestamptz not null default now(),
  versioned_by uuid references siringetbase.role_profiles(id),
  change_reason text,

  created_at timestamptz not null default now()
);

create index if not exists comms_templates_versions_template_id_idx
  on siringetbase.comms_templates_versions(template_id);
create index if not exists comms_templates_versions_versioned_at_idx
  on siringetbase.comms_templates_versions(template_id, versioned_at desc);

comment on table siringetbase.comms_templates_versions is
  'Snapshot of siringetbase.comms_templates taken immediately before every overwrite (see src/lib/comms/templates/store.ts''s upsertCommsTemplate()) — lets an admin recover the last working version of a template after a bad edit. Insert-only; never updated or pruned automatically.';

alter table siringetbase.comms_templates enable row level security;
alter table siringetbase.comms_templates_versions enable row level security;

-- Same posture as extraction_templates/extraction_templates_versions and
-- every other admin-only control-plane table in this codebase:
-- service-role + app-code-enforced (requireAdmin() in the API routes),
-- RLS as defense-in-depth. No authenticated grant.
grant all on siringetbase.comms_templates to service_role;
grant all on siringetbase.comms_templates_versions to service_role;
