#!/usr/bin/env node
// Multi-instance migration push (Anand's 2026-07-21 decision): one
// .env.local holds country-coded DB URLs; push targets are explicit so the
// CLI's linked project can never be hit by accident.
//   npm run db:push:us | db:push:in | db:push:global
// Runtime code NEVER reads these suffixed vars — each deployed instance
// gets its single un-suffixed env (GLOBAL/01: core is byte-identical).

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = (process.argv[2] || "").toUpperCase(); // US | IN | GLOBAL
const mode = process.argv[3] === "test" ? "test" : "push"; // push (default) | test = pgTAP
const workdir = process.argv[4]; // optional: another app's folder (e.g. ../../pmmusa/app)
if (!["US", "IN", "GLOBAL"].includes(target)) {
  console.error("Usage: node scripts/db-push.mjs <us|in|global> [push|test] [workdir]");
  process.exit(1);
}

// Load .env.local (no dependency on dotenv).
const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const url = process.env[`SUPABASE_DB_URL_${target}`];
if (!url) {
  console.error(`Missing SUPABASE_DB_URL_${target} in .env.local`);
  process.exit(1);
}

const args =
  mode === "test"
    ? ["supabase", "test", "db", "--db-url", url]
    : ["supabase", "db", "push", "--db-url", url];
if (workdir) args.push("--workdir", workdir);
console.log(`${mode === "test" ? "Running pgTAP tests on" : "Pushing migrations to"} ${target}${workdir ? " for " + workdir : ""} (explicit --db-url)…`);
const r = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
