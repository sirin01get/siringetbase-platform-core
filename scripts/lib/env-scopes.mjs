// Single source of truth for "which env vars belong on the deployed Worker".
//
// Parsed out of .env.example's `# scope:` annotations rather than kept as a
// list in here. That file already had to carry the distinction for humans,
// and a second hand-maintained list is exactly the drift that
// check-env-var-specs.mjs exists to prevent elsewhere in this repo. Annotating
// a var in .env.example is now the only step needed for it to be synced and
// verified on deploy.
//
// ── The scopes, and why the distinctions are load-bearing ────────────────
//
//   build            NEXT_PUBLIC_*. Inlined into the bundle by `next build`,
//                    which reads .env.local on the machine running the build.
//                    NOT read from the Worker at runtime, so setting these in
//                    Cloudflare achieves nothing — a genuine and repeated
//                    source of confusion.
//
//   runtime          Read from process.env INSIDE the Worker at request time.
//                    Must exist on the Worker itself; .env.local has no
//                    bearing on them. Stored as Worker Secrets — not because
//                    every one is sensitive (a base URL isn't), but because
//                    Secrets are the only store that survives
//                    `wrangler deploy`, which reconciles by full overwrite.
//
//   runtime, optional  As above, but the code has a default or tolerates
//                    absence. Synced when present; never demanded.
//                    A declaration COMMENTED OUT in .env.example is treated as
//                    optional automatically — that is already what commenting
//                    it out means, so it needs no extra annotation.
//
//   tooling          Credentials used by wrangler/CI on a developer machine
//                    (CLOUDFLARE_API_TOKEN and friends). Deliberately excluded:
//                    uploading deploy credentials INTO the thing they deploy
//                    would be a real security smell, not a convenience.
//
//   binding          Named in .env.example for orientation but actually
//                    configured in wrangler.jsonc (R2, D1, KV, AI). Not an
//                    env var at all.
//
// Duplicated verbatim across siringetbase/platform-core, cafocus/app and
// lawforge/app — the same "pattern, not shared code" framing as
// check-env-var-specs.mjs, since these are separate deployments with no
// shared import path. Keep the copies in step by hand.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..", "..");

function classify(terms) {
  const t = terms.toLowerCase();
  if (/\btooling\b/.test(t)) return "tooling";
  if (/\bbinding\b/.test(t)) return "binding";
  if (/\bbuild\b/.test(t)) return "build";
  if (/\bruntime\b|\bsecret\b/.test(t)) return "runtime";
  return null;
}

/**
 * Read .env.example and bucket every declared variable by its `# scope:` line.
 *
 * A `# scope:` comment applies to every variable declared after it until the
 * next `# scope:` comment.
 */
export function readEnvScopes() {
  const source = readFileSync(path.join(repoRoot, ".env.example"), "utf8");

  const runtimeSecrets = [];
  const runtimeOptional = [];
  const buildTime = [];
  const excluded = [];
  const unscoped = [];
  const unknownScopes = [];

  let scope = null;
  let scopeIsOptional = false;

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();

    const scopeLine = line.match(/^#\s*scope:\s*(.+)$/i);
    if (scopeLine) {
      const terms = scopeLine[1];
      scope = classify(terms);
      scopeIsOptional = /\boptional\b/i.test(terms);
      if (scope === null) unknownScopes.push(terms.trim());
      continue;
    }

    // Both `FOO=` and `# FOO=` are declarations. The commented form is how
    // both repos already write "supported, not set by default", so it is read
    // as optional rather than ignored — otherwise a var the code genuinely
    // reads would be invisible to every check downstream of this.
    const decl = line.match(/^#?\s*([A-Z][A-Z0-9_]*)=/);
    if (!decl) continue;

    const name = decl[1];
    const isCommented = line.startsWith("#");

    if (scope === null) {
      unscoped.push(name);
      continue;
    }
    if (scope === "tooling" || scope === "binding") {
      excluded.push(name);
      continue;
    }
    if (scope === "build") {
      buildTime.push(name);
      continue;
    }
    if (scopeIsOptional || isCommented) runtimeOptional.push(name);
    else runtimeSecrets.push(name);
  }

  return { runtimeSecrets, runtimeOptional, buildTime, excluded, unscoped, unknownScopes };
}

/** Every var .env.example declares, whatever its scope. */
export function allDeclared(scopes = readEnvScopes()) {
  return new Set([
    ...scopes.runtimeSecrets,
    ...scopes.runtimeOptional,
    ...scopes.buildTime,
    ...scopes.excluded,
  ]);
}

/** Worker name these secrets belong to. Kept in step with wrangler.jsonc. */
export function workerName() {
  const source = readFileSync(path.join(repoRoot, "wrangler.jsonc"), "utf8");
  const match = source.match(/"name"\s*:\s*"([^"]+)"/);
  if (!match) throw new Error('Could not read "name" from wrangler.jsonc.');
  return match[1];
}

/**
 * Parse a dotenv file into a plain object. Deliberately minimal — no
 * interpolation, no export prefixes, no multiline values. If this repo ever
 * needs those, use a real dotenv parser rather than growing this one.
 */
export function readDotenv(filePath) {
  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const out = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
