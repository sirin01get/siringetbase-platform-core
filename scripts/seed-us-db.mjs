#!/usr/bin/env node
// Applies the demo-tenant seed to the US database (idempotent).
// Usage: npm run db:seed:us
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const url = process.env.SUPABASE_DB_URL_US;
if (!url) { console.error("Missing SUPABASE_DB_URL_US"); process.exit(1); }

// Guard (doc 12 §D2): seeding must never hit production by muscle memory.
if (process.env.PMMUSA_ALLOW_SEED !== "1") {
  console.error(
    "Refusing to seed: set PMMUSA_ALLOW_SEED=1 to confirm this DB is staging/demo, NOT prod.\n" +
    "  PowerShell:  $env:PMMUSA_ALLOW_SEED=1; npm run db:seed:us"
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
const run = async () => {
  await client.connect();
  await client.query(readFileSync(root + "pmmusa/app/supabase/seed/demo_tenant.sql", "utf8"));
  const { rows } = await client.query(
    "select (select count(*) from pmmusa.units) units, (select count(*) from pmmusa.firm_vendors) vendors, (select count(*) from pmmusa.work_orders) work_orders"
  );
  await client.end();
  console.log("✅ Demo tenant seeded:", rows[0]);
};
run().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
