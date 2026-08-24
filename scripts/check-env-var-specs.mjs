#!/usr/bin/env node
// Fails CI if src/config/env.ts and src/lib/admin/env-check.ts's
// ENV_VAR_SPECS drift apart — see ../env-check/README.md for why this
// exists (short version: a hand-maintained parallel list drifts
// eventually, and a var only in env.ts is invisible to the precheck
// dashboard). Deliberately simple regex-based static analysis, not a
// TypeScript AST parse — config/env.ts's `process.env.NAME` call shape is
// consistent enough across this codebase that regex is reliable, and
// running this needs no build step of its own, which matters for a CI
// step meant to run before the real build.
//
// Same script, same logic, duplicated in cafocus/app/scripts/ and
// lawforge/app/scripts/ — no shared import path between these deployments
// (see ../env-check/README.md's "pattern, not shared code" framing). Keep the
// copies in sync by hand if the *logic* here ever changes; this file only
// reads the vars, it doesn't need repo-specific knowledge, so any future
// vertical can copy it as-is.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readEnvScopes, allDeclared } from "./lib/env-scopes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const envTsPath = path.join(repoRoot, "src", "config", "env.ts");
const envCheckTsPath = path.join(repoRoot, "src", "lib", "admin", "env-check.ts");

function extractVarsFromEnvTs(source) {
  const found = new Set();
  const re = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    found.add(match[1]);
  }
  return found;
}

function extractVarsFromEnvCheckTs(source) {
  // Only look inside the ENV_VAR_SPECS array literal, not the whole file
  // (isLikelyValidUrl/fingerprint etc. don't contain var names, but being
  // scoped avoids ever accidentally matching something outside the list).
  const arrayMatch = source.match(/ENV_VAR_SPECS[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!arrayMatch) {
    throw new Error("Could not find ENV_VAR_SPECS array literal in env-check.ts — did its shape change?");
  }
  const body = arrayMatch[1];
  const found = new Set();
  const re = /name:\s*"([A-Z][A-Z0-9_]*)"/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    found.add(match[1]);
  }
  return found;
}

const envTsSource = readFileSync(envTsPath, "utf8");
const envCheckTsSource = readFileSync(envCheckTsPath, "utf8");

const varsInEnvTs = extractVarsFromEnvTs(envTsSource);
const varsInSpecs = extractVarsFromEnvCheckTs(envCheckTsSource);

const missingFromSpecs = [...varsInEnvTs].filter((v) => !varsInSpecs.has(v)).sort();
const staleInSpecs = [...varsInSpecs].filter((v) => !varsInEnvTs.has(v)).sort();

// Third leg, added 2026-08-24: every var must also be DECLARED IN .env.example
// UNDER A `# scope:` HEADING. scripts/sync-secrets.mjs and
// scripts/verify-deployed-secrets.mjs both derive the runtime-secret list from
// those annotations, so a var that env.ts reads but .env.example never
// declares would be silently skipped by both — never pushed to the Worker, and
// never reported missing. That is precisely the invisible-gap failure those
// two scripts exist to close, so it gets a check of its own rather than a
// comment asking people to remember.
const scopes = readEnvScopes();
const { runtimeSecrets, runtimeOptional, buildTime, unscoped, unknownScopes } = scopes;
const missingFromExample = [...varsInEnvTs].filter((v) => !allDeclared(scopes).has(v)).sort();

if (
  missingFromSpecs.length === 0 &&
  staleInSpecs.length === 0 &&
  missingFromExample.length === 0 &&
  unscoped.length === 0 &&
  unknownScopes.length === 0
) {
  console.log(
    `check-env-var-specs: OK — ${varsInEnvTs.size} vars in sync across env.ts, ENV_VAR_SPECS ` +
      `and .env.example (${runtimeSecrets.length} required runtime, ${runtimeOptional.length} optional, ` +
      `${buildTime.length} build-time).`
  );
  process.exit(0);
}

if (unknownScopes.length > 0) {
  console.error(
    `check-env-var-specs: FAIL — .env.example has ${unknownScopes.length} unrecognised "# scope:" heading(s):`
  );
  for (const s of unknownScopes) console.error(`  - "${s}"`);
  console.error("  Valid: build | runtime | runtime, optional | tooling | binding");
}

if (missingFromExample.length > 0) {
  console.error(
    `check-env-var-specs: FAIL — ${missingFromExample.length} var(s) read in src/config/env.ts but not declared under a "# scope:" heading in .env.example:`
  );
  for (const v of missingFromExample) console.error(`  - ${v}`);
  console.error(
    "  Declare each under one of: build | runtime | runtime, optional | tooling | binding.\n" +
      "  Without that, npm run secrets:sync will never push it and secrets:verify will never miss it."
  );
}

if (unscoped.length > 0) {
  console.error(
    `check-env-var-specs: FAIL — ${unscoped.length} var(s) declared in .env.example before any "# scope:" heading:`
  );
  for (const v of unscoped) console.error(`  - ${v}`);
}

if (missingFromSpecs.length > 0) {
  console.error(
    `check-env-var-specs: FAIL — ${missingFromSpecs.length} var(s) read in src/config/env.ts but missing from ENV_VAR_SPECS in src/lib/admin/env-check.ts:`
  );
  for (const v of missingFromSpecs) console.error(`  - ${v}`);
}

if (staleInSpecs.length > 0) {
  console.error(
    `check-env-var-specs: FAIL — ${staleInSpecs.length} var(s) in ENV_VAR_SPECS but no longer read anywhere in src/config/env.ts (stale entry, or renamed without updating both places):`
  );
  for (const v of staleInSpecs) console.error(`  - ${v}`);
}

console.error("\nSee ../env-check/README.md for the pattern — a var added to env.ts and its ENV_VAR_SPECS entry must land in the same commit.");
process.exit(1);
