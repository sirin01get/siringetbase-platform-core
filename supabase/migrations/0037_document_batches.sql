-- Bulk document upload — the owner's ask: "make this a bulk upload of all
-- types of invoices and it does the same job" for cafocus/app's document
-- intake (src/components/documents/DocumentIntake.tsx). One
-- document_batches row per bulk-upload action; siringetbase.documents gets
-- a nullable batch_id FK so every document belonging to a batch can be
-- found with a single indexed lookup.
--
-- Deliberately minimal — no status/progress columns here. Batch progress
-- (queued/completed/failed counts) is always computed LIVE by grouping
-- siringetbase.documents by status where batch_id = X, never stored
-- redundantly — same "computed, not stored" posture as
-- src/lib/documents/review.ts's needsReview and env-check's live test
-- results, so there's no dual-write to keep in sync and no risk of a
-- stored counter drifting from the documents rows it's supposed to
-- summarize.
--
-- Lives in siringetbase (not cafocus) for the same reason documents/
-- extraction_templates/extraction_jobs do — platform-core owns this whole
-- subsystem; cafocus/app writes into it cross-schema via its existing
-- siringetbase-admin.ts service-role client, exactly like it already does
-- for siringetbase.documents today.
--
-- Idempotent — safe to re-run.

create table if not exists siringetbase.document_batches (
  id uuid primary key default gen_random_uuid(),
  owner_role_profile_id uuid not null references siringetbase.role_profiles(id),
  vertical text not null,
  -- Every file in one bulk-upload action shares one document_type today
  -- (the UI asks "what kind of documents are these?" once, then accepts
  -- many files) — see cafocus/app's DocumentIntake.tsx bulk-mode comment
  -- for why per-file mixed types was deliberately out of scope for this
  -- first cut, not an oversight.
  document_type text not null,
  file_count integer not null check (file_count > 0),
  created_at timestamptz not null default now()
);

create index if not exists document_batches_owner_role_profile_id_idx
  on siringetbase.document_batches(owner_role_profile_id);

alter table siringetbase.documents
  add column if not exists batch_id uuid references siringetbase.document_batches(id) on delete set null;

create index if not exists documents_batch_id_idx on siringetbase.documents(batch_id);

alter table siringetbase.document_batches enable row level security;

drop policy if exists "owner can read own document_batches" on siringetbase.document_batches;
create policy "owner can read own document_batches" on siringetbase.document_batches
  for select using (
    owner_role_profile_id in (select id from siringetbase.role_profiles where user_id = auth.uid())
  );

grant select, insert on siringetbase.document_batches to authenticated;
grant all on siringetbase.document_batches to service_role;
