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
// Same script, same logic, duplicated in cafocus/app/scripts/ — no shared
// import path between these two deployments (see ../env-check/README.md's
// "pattern, not shared code" framing). Keep both copies in sync by hand if
// the *logic* here ever changes; this file only reads the vars, it doesn't
// need repo-specific knowledge, so any future vertical can copy it as-is.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

if (missingFromSpecs.length === 0 && staleInSpecs.length === 0) {
  console.log(`check-env-var-specs: OK — ${varsInEnvTs.size} vars in sync between env.ts and ENV_VAR_SPECS.`);
  process.exit(0);
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
