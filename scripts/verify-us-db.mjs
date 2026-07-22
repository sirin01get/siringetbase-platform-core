#!/usr/bin/env node
// Applies the pmmusa vertical migrations and runs the pgTAP RLS suites over
// a direct pg connection — no Docker (supabase test db needs it) and no
// shared migration-history collision (supabase db push can't handle a
// second app in one database). Talks to whichever SUPABASE_DB_URL_<target>
// is set. Usage: node scripts/verify-us-db.mjs us
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const target = (process.argv[2] || "US").toUpperCase();
const root = fileURLToPath(new URL("../../../", import.meta.url)); // prototype/
const here = fileURLToPath(new URL("../", import.meta.url)); // platform-core/

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const url = process.env[`SUPABASE_DB_URL_${target}`];
if (!url) { console.error(`Missing SUPABASE_DB_URL_${target}`); process.exit(1); }

const applyFiles = [
  root + "pmmusa/app/supabase/migrations/0001_init.sql",
  root + "pmmusa/app/supabase/migrations/0002_firm_vendors.sql",
  root + "pmmusa/app/supabase/migrations/0003_grants.sql",
  root + "pmmusa/app/supabase/migrations/0004_apply_transition_rpc.sql",
];
const testFiles = [
  here + "supabase/tests/rls_global_directory_deny_all.sql",
  root + "pmmusa/app/supabase/tests/rls_tenant_isolation.sql",
  root + "pmmusa/app/supabase/tests/rpc_apply_transition.sql",
];

const client = new pg.Client({ connectionString: url });

function printResults(res) {
  const arr = Array.isArray(res) ? res : [res];
  let notOk = 0;
  for (const r of arr) {
    for (const row of r.rows ?? []) {
      const line = String(Object.values(row)[0] ?? "");
      if (line) console.log("   " + line);
      if (/^not ok/.test(line)) notOk++;
    }
  }
  return notOk;
}

const run = async () => {
  await client.connect();
  console.log(`Connected to ${target}.\n`);

  for (const f of applyFiles) {
    process.stdout.write(`APPLY ${f.split("/").slice(-1)[0]} … `);
    await client.query(readFileSync(f, "utf8"));
    console.log("ok");
  }

  let failed = 0;
  for (const f of testFiles) {
    console.log(`\nPGTAP ${f.split("/").slice(-1)[0]}`);
    const res = await client.query(readFileSync(f, "utf8"));
    failed += printResults(res);
  }

  await client.end();
  console.log(failed === 0 ? "\n✅ ALL PGTAP ASSERTIONS PASSED" : `\n❌ ${failed} assertion(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
};
run().catch((e) => { console.error("\nERROR:", e.message); process.exit(1); });
