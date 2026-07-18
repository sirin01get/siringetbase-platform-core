-- Document Intelligence — skeleton tables, per
-- ../../document-intelligence/README.md's "Model (Generic)" section.
-- CA Focus's Phase 1 (../../../cafocus/phases/phase-1-core-data-graph-model/)
-- lists "Siringetbase's document-intelligence subsystem must exist (even in
-- skeleton form)" as a hard dependency for registering extraction templates
-- — this migration is that skeleton. Pipeline mechanics (R2 upload, Model
-- Gateway extraction calls, the extraction.completed event) are NOT built
-- here, only the tables; that's a later Document Intelligence build-out,
-- not part of CA Focus Phase 1's scope.
--
-- Also extends entity_sync_queue's entity_type check constraint to include
-- 'engagement' — CA Focus's Phase 1 engagements need to sync into the
-- shared graph as (:Person)-[:ENGAGED]->(:ServiceProvider), which is a
-- different sync shape than the existing person/business/service_provider
-- node upserts. Small, additive, unrelated to the Cron/retry/batching work
-- in 0002_sync_retry_hardening.sql — this just adds one more entity_type
-- value the same outbox mechanism already supports.
--
-- Idempotent throughout (IF NOT EXISTS / DROP ... IF EXISTS before CREATE) —
-- safe to re-run in full any number of times, e.g. after a partial failure
-- partway through, without a "relation already exists" error stopping it.

-- ---------------------------------------------------------------------------
-- Document Intelligence (../../document-intelligence/README.md)
-- ---------------------------------------------------------------------------

create table if not exists siringetbase.extraction_templates (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,          -- e.g. 'form16', 'gst_sales_invoice'
  vertical text not null,
  owning_module text not null,          -- e.g. 'cafocus/individual', 'cafocus/ca'
  prompt text not null,
  output_schema jsonb not null,
  confidence_threshold numeric(3, 2) not null default 0.80,
  requires_human_review boolean not null default false,
  created_at timestamptz not null default now(),
  constraint extraction_templates_type_vertical_unique unique (document_type, vertical)
);

create table if not exists siringetbase.documents (
  id uuid primary key default gen_random_uuid(),
  owner_role_profile_id uuid not null references siringetbase.role_profiles(id),
  vertical text not null,
  document_type text not null,
  storage_pointer text not null,        -- R2 key/path; R2 wiring itself not built yet
  original_filename text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'extraction_queued', 'extraction_completed', 'extraction_failed')),
  created_at timestamptz not null default now()
);

create index if not exists documents_owner_role_profile_id_idx on siringetbase.documents(owner_role_profile_id);
create index if not exists documents_vertical_type_idx on siringetbase.documents(vertical, document_type);

create table if not exists siringetbase.extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references siringetbase.documents(id),
  template_id uuid not null references siringetbase.extraction_templates(id),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  raw_output jsonb,
  interpretation jsonb,
  confidence numeric(3, 2),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists extraction_jobs_document_id_idx on siringetbase.extraction_jobs(document_id);

alter table siringetbase.extraction_templates enable row level security;
alter table siringetbase.documents enable row level security;
alter table siringetbase.extraction_jobs enable row level security;

-- Templates are a registry, not sensitive data — readable by any
-- authenticated user (mirrors ServiceType's openness in the entity graph).
drop policy if exists "authenticated can read extraction_templates" on siringetbase.extraction_templates;
create policy "authenticated can read extraction_templates" on siringetbase.extraction_templates
  for select using (auth.role() = 'authenticated');

drop policy if exists "owner can read own documents" on siringetbase.documents;
create policy "owner can read own documents" on siringetbase.documents
  for select using (
    owner_role_profile_id in (select id from siringetbase.role_profiles where user_id = auth.uid())
  );

drop policy if exists "owner can read own extraction_jobs" on siringetbase.extraction_jobs;
create policy "owner can read own extraction_jobs" on siringetbase.extraction_jobs
  for select using (
    document_id in (
      select id from siringetbase.documents
      where owner_role_profile_id in (select id from siringetbase.role_profiles where user_id = auth.uid())
    )
  );

grant usage on schema siringetbase to anon, authenticated, service_role;
grant select, insert, update, delete on siringetbase.documents to authenticated;
grant select, insert, update, delete on siringetbase.extraction_jobs to authenticated;
grant select on siringetbase.extraction_templates to authenticated, anon;
grant all on siringetbase.documents, siringetbase.extraction_templates, siringetbase.extraction_jobs to service_role;

-- ---------------------------------------------------------------------------
-- entity_sync_queue: add 'engagement' as a valid entity_type
-- ---------------------------------------------------------------------------

do $$
declare
  existing_constraint_name text;
begin
  select conname into existing_constraint_name
  from pg_constraint
  where conrelid = 'siringetbase.entity_sync_queue'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%entity_type%person%';

  if existing_constraint_name is not null then
    execute format('alter table siringetbase.entity_sync_queue drop constraint %I', existing_constraint_name);
  end if;
end $$;

alter table siringetbase.entity_sync_queue
  add constraint entity_sync_queue_entity_type_check
  check (entity_type in ('person', 'business', 'service_provider', 'engagement'));
