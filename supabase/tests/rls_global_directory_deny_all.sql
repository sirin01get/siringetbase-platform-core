-- pgTAP — global directory deny-all (0012_global_directory.sql; GLOBAL/01
-- §B: written and read ONLY by the service-role ingest path). With
-- "auto-expose new tables" OFF, anon/authenticated have NO grant on these
-- tables at all, so access is denied at the privilege layer (42501) before
-- RLS even runs — a stronger deny-all than row-filtering. This suite pins
-- that: end users hit permission-denied on every operation.

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

-- Seed as the connection role (owner) — the migration's intended writer.
insert into siringetbase.global_directory (global_person_id, email_hash, home_region)
values ('90000000-0000-0000-0000-000000000001', repeat('a', 64), 'us');

insert into auth.users (id, email)
values ('90000000-0000-0000-0000-00000000000e', 'someone@example.test');

set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-00000000000e';

select throws_ok(
  $$ select count(*) from siringetbase.global_directory $$,
  '42501', null,
  'Authenticated users cannot read global_directory'
);

select throws_ok(
  $$ select count(*) from siringetbase.global_roles $$,
  '42501', null,
  'Authenticated users cannot read global_roles'
);

select throws_ok(
  $$ insert into siringetbase.global_directory (email_hash, home_region)
     values (repeat('b', 64), 'in') $$,
  '42501', null,
  'Authenticated users cannot insert into global_directory'
);

set local role anon;

select throws_ok(
  $$ select count(*) from siringetbase.global_directory $$,
  '42501', null,
  'Anonymous cannot read global_directory'
);

select * from finish();
rollback;
