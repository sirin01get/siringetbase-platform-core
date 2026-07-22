-- payout_accounts: rail discriminator — IFSC row OR routing+account row —
-- exactly as country-extension/usa and USVALUE/PMMUSA/03-siringetbase-reuse.md
-- §B3 specify. Expand-only (GLOBAL/05 §C: expand-migrate-contract; no
-- breaking drops): existing rows become account_type='in_ifsc', ifsc stays
-- required for that type via the check constraint, and us_ach rows carry a
-- routing number instead. Mirrors src/lib/payments/types.ts
-- PayoutDestination — adding a rail later (SEPA, AU BSB) is a new
-- account_type value + column, never a rewrite.

alter table siringetbase.payout_accounts
  add column if not exists account_type text not null default 'in_ifsc'
    check (account_type in ('in_ifsc', 'us_ach')),
  add column if not exists routing_number text;

-- ifsc was not null at creation (0001); relax it so us_ach rows can omit it.
alter table siringetbase.payout_accounts
  alter column ifsc drop not null;

-- Exactly the right rail field per type. Named constraint so the paired
-- rollback below can drop it precisely.
alter table siringetbase.payout_accounts
  add constraint payout_accounts_rail_fields check (
    (account_type = 'in_ifsc' and ifsc is not null and routing_number is null)
    or
    (account_type = 'us_ach' and routing_number is not null and ifsc is null)
  );

-- Tested rollback (GLOBAL/05 §C "every migration has a tested rollback"):
--   alter table siringetbase.payout_accounts drop constraint payout_accounts_rail_fields;
--   alter table siringetbase.payout_accounts alter column ifsc set not null;
--   alter table siringetbase.payout_accounts drop column routing_number, drop column account_type;
