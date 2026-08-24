#!/usr/bin/env node
// Fail the deploy if the Worker is missing a runtime secret.
//
// Wired into `npm run deploy` AFTER the deploy step. That ordering is the
// point: a deploy that silently drops a secret currently "succeeds", and the
// damage only surfaces later as a feature that quietly does nothing —
// reminder emails that never send, a cross-Worker call that 401s into a
// swallowed catch. Nothing about the deploy output hints at it.
//
// This turns that class of failure from invisible-and-later into
// loud-and-now. It is the guard, not the fix; `npm run secrets:sync` is the
// fix, and this tells you to run it.
//
// Kept separate from check-env-var-specs.mjs on purpose. That one is static
// analysis of the source and belongs in CI. This one talks to Cloudflare
// about a specific deployed Worker, needs credentials, and belongs at deploy
// time — CI has no business holding deploy credentials just to run a check.

import { execFileSync } from "node:child_process";
import { readEnvScopes, workerName, repoRoot } from "./lib/env-scopes.mjs";

const worker = workerName();
// Only the REQUIRED runtime vars gate a deploy. Optional ones are absent by
// design on most deployments — failing on those would train everyone to
// ignore this check, which is worse than not having it.
const { runtimeSecrets, runtimeOptional } = readEnvScopes();

function listSecrets() {
  let out;
  try {
    out = execFileSync("npx", ["wrangler", "secret", "list", "--name", worker], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (/not found|no secrets/i.test(text)) return [];
    // Not authenticated, offline, etc. Warn rather than fail the whole
    // deploy — the deploy itself already succeeded by the time this runs,
    // and failing here would wrongly imply it didn't. Stack frames are
    // stripped: wrangler prints a long Node trace for environment problems
    // and it buries the line that actually says what went wrong.
    const summary = text
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() && !/^\s+at /.test(l))
      .slice(0, 6)
      .join("\n");
    console.warn(
      `\nsecrets:verify — could not reach Cloudflare to check secrets:\n${summary}\n\n` +
        `The deploy itself SUCCEEDED; only this check was skipped.\n` +
        `Re-run \`npm run secrets:verify\` once you can.`
    );
    process.exit(0);
  }
  try {
    const parsed = JSON.parse(out);
    if (Array.isArray(parsed)) return parsed.map((s) => s.name).filter(Boolean);
  } catch {
    /* table output — fall through */
  }
  return [...out.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map((m) => m[1]);
}

const present = listSecrets();
const missing = runtimeSecrets.filter((name) => !present.includes(name));

if (missing.length === 0) {
  const optionalSet = runtimeOptional.filter((n) => present.includes(n));
  console.log(
    `secrets:verify — OK. All ${runtimeSecrets.length} required runtime secrets are set on ${worker}` +
      (optionalSet.length > 0 ? `, plus ${optionalSet.length} optional (${optionalSet.join(", ")}).` : ".")
  );
  process.exit(0);
}

console.error(
  `\nsecrets:verify — FAIL. ${missing.length} runtime secret(s) missing on ${worker}:\n` +
    missing.map((n) => `  - ${n}`).join("\n") +
    `\n\nThe code deployed, but these code paths will fail at runtime:\n` +
    `src/config/env.ts throws on a missing var, so the affected route returns a\n` +
    `500 rather than misbehaving quietly — but only once someone hits it.\n\n` +
    `Fix:\n` +
    `  npm run secrets:sync\n\n` +
    `If a value is missing from .env.local too, get it from the other deployment —\n` +
    `the *_INTERNAL_SECRET values must match platform-core exactly, byte for byte.\n` +
    `A mismatch is worse than an absence: both sides report "configured" and the\n` +
    `call just 401s.\n`
);
process.exit(1);
