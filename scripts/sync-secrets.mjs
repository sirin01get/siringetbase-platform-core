#!/usr/bin/env node
// Push every runtime secret from .env.local up to the Cloudflare Worker as a
// real Secret. One command, idempotent, safe to re-run.
//
// ── Why this exists ──────────────────────────────────────────────────────
// Runtime secrets on this Worker kept reverting to "not set" after a deploy,
// repeatedly, despite being present in .env.local. Two separate facts
// combine to cause that, and neither is obvious on its own:
//
//   1. `wrangler deploy` reconciles configuration by FULL OVERWRITE, not
//      merge. A plain-text Variable that exists on the Worker but is absent
//      from wrangler.jsonc is DELETED on the next deploy. wrangler.jsonc's
//      own comment about the `routes` block records this same lesson learned
//      the hard way for custom domains — it just was never applied to vars.
//      Secrets (`wrangler secret put`) are exempt: they always survive.
//
//   2. .env.local is a LOCAL file. It is never uploaded anywhere. It feeds
//      `next build` on this machine, which is why NEXT_PUBLIC_* values
//      appear to "work" from it — those get inlined into the bundle at build
//      time. Server-side secrets are read from process.env inside the Worker
//      at request time, and the Worker knows nothing about .env.local.
//
// So: setting these in the Cloudflare dashboard as Variables guarantees they
// vanish on the next deploy, and having them in .env.local does nothing for
// the deployed app. Storing them as Secrets is the only arrangement that
// survives, and this script makes doing that a single command instead of
// four prompts nobody remembers the order of.
//
// Usage:
//   npm run secrets:sync              push everything missing or changed
//   npm run secrets:sync -- --dry-run show what would be pushed
//   npm run secrets:sync -- --force   re-push even ones already present
//
// Values are read from .env.local and piped to wrangler over stdin, so they
// never appear in a command line, in shell history, or in this repo.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { readEnvScopes, readDotenv, workerName, repoRoot } from "./lib/env-scopes.mjs";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const force = argv.includes("--force");

const worker = workerName();
const { runtimeSecrets, runtimeOptional, buildTime, excluded } = readEnvScopes();
const local = readDotenv(path.join(repoRoot, ".env.local"));

if (!local) {
  console.error(
    "No .env.local found.\n" +
      "Copy .env.example to .env.local and fill in the values first — this script\n" +
      "reads from it and never stores secrets itself."
  );
  process.exit(1);
}

function wrangler(args, options = {}) {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    // npx resolves through a .cmd shim on Windows, which needs a shell.
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
}

/**
 * Trim a wrangler failure to something a person can act on. Wrangler prints
 * long Node stack traces for environment problems (a workerd binary built for
 * the wrong platform, most commonly), and dumping all of it buries the one
 * line that matters.
 */
function summarise(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/^\s+at /.test(l));
  return lines.slice(0, 6).join("\n");
}

/** Names of secrets already on the Worker. Empty list if the Worker has none. */
function existingSecretNames() {
  let out;
  try {
    out = wrangler(["secret", "list", "--name", worker]);
  } catch (err) {
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    // A Worker with no secrets yet, or not yet created, is not an error here —
    // it just means everything needs pushing.
    if (/not found|no secrets/i.test(text)) return [];
    if (dryRun) {
      console.warn(
        "\nCould not reach Cloudflare to see what is already set, so this dry run\n" +
          "assumes nothing is:\n" +
          summarise(text) +
          "\n"
      );
      return [];
    }
    console.error(
      "\nCould not list existing secrets on " + worker + ":\n" +
        summarise(text) +
        "\n\nCommon causes: not logged in (`npx wrangler login`), the wrong Cloudflare\n" +
        "account selected, or node_modules installed on a different OS than the one\n" +
        "running this. Nothing has been changed."
    );
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(out);
    if (Array.isArray(parsed)) return parsed.map((s) => s.name).filter(Boolean);
  } catch {
    // Newer wrangler prints a table rather than JSON. Fall back to scanning
    // for anything that looks like an env var name.
  }
  return [...out.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map((m) => m[1]);
}

console.log(`Worker: ${worker}`);
console.log(
  `Declared in .env.example: ${runtimeSecrets.length} required runtime, ` +
    `${runtimeOptional.length} optional runtime, ${buildTime.length} build-time, ${excluded.length} excluded.`
);

const already = force ? [] : existingSecretNames();

const missingLocally = [];
const toPush = [];
const skipped = [];
const optionalUnset = [];

for (const name of runtimeSecrets) {
  const value = local[name];
  if (!value) {
    missingLocally.push(name);
    continue;
  }
  if (already.includes(name)) skipped.push(name);
  else toPush.push(name);
}

// Optional vars are pushed when a value exists locally and skipped silently
// when it doesn't — that is what "the code has a default" means in practice.
for (const name of runtimeOptional) {
  const value = local[name];
  if (!value) {
    optionalUnset.push(name);
    continue;
  }
  if (already.includes(name)) skipped.push(name);
  else toPush.push(name);
}

if (missingLocally.length > 0) {
  console.error(
    `\n${missingLocally.length} runtime secret(s) are declared in .env.example but blank or absent in .env.local:`
  );
  for (const n of missingLocally) console.error(`  - ${n}`);
  console.error(
    "\nFill these in before syncing. A partially-synced Worker is the failure mode\n" +
      "this script exists to end, so nothing is pushed until every value is present."
  );
  process.exit(1);
}

if (skipped.length > 0) {
  console.log(`\nAlready set on the Worker (use --force to overwrite): ${skipped.join(", ")}`);
}

if (optionalUnset.length > 0) {
  console.log(`\nOptional and unset locally, so not pushed: ${optionalUnset.join(", ")}`);
}

if (toPush.length === 0) {
  console.log("\nNothing to push — every runtime secret is already set.");
} else {
  console.log(`\nPushing ${toPush.length} secret(s): ${toPush.join(", ")}`);
  for (const name of toPush) {
    if (dryRun) {
      console.log(`  [dry-run] would set ${name}`);
      continue;
    }
    try {
      wrangler(["secret", "put", name, "--name", worker], { input: local[name] });
      console.log(`  set ${name}`);
    } catch (err) {
      console.error(
        `  FAILED to set ${name}:\n${summarise(`${err.stdout ?? ""}${err.stderr ?? ""}`)}\n\n` +
          `Stopping here. Secrets set before this one are already applied; re-running\n` +
          `is safe and will pick up where this left off.`
      );
      process.exit(1);
    }
  }
}

// The build-scope reminder is here because it is the other half of the same
// confusion: people set NEXT_PUBLIC_* on Cloudflare, watch it get wiped, and
// conclude secrets are broken — when those particular vars were never read
// from the Worker in the first place.
console.log(
  `\nNot pushed, and deliberately so — ${buildTime.join(", ")}.\n` +
    `These are inlined into the bundle by \`next build\`, which reads .env.local on\n` +
    `THIS machine. They are not read from the Worker at runtime, so setting them in\n` +
    `Cloudflare achieves nothing. If one of them is wrong in a deployed build, fix\n` +
    `.env.local and redeploy — changing it in the dashboard will not help.`
);

if (excluded.length > 0) {
  console.log(
    `\nAlso never pushed — ${excluded.join(", ")}.\n` +
      `Tooling credentials and wrangler.jsonc bindings. Uploading deploy credentials\n` +
      `into the Worker they deploy would widen their blast radius for no benefit.`
  );
}
