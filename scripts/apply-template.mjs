#!/usr/bin/env node
// Writes (or previews) an extraction_templates edit outside the admin UI,
// using the service-role key — the CLI counterpart to
// src/lib/document-intelligence/templates.ts's upsertExtractionTemplate(),
// for exactly one scenario: a Claude session handling an approved
// itr_gov_change_alerts "form" alert on a person's explicit instruction (see
// ../../cafocus/phases/itr-gov-change-agent-analysis.md's "Handling an
// approved alert" section). There's no admin-session cookie to authenticate
// with from a plain script, so this reuses the same trust level
// cafocus/app/scripts/grant-admin.mjs already established for the identical
// problem (an out-of-band action that needs the project's service-role
// key, logged as a distinct 'cli' actor so it's never confused with an
// in-app admin action).
//
// Deliberately reimplements upsertExtractionTemplate()'s snapshot-then-write
// logic rather than importing it — that function lives in a Next.js/
// Cloudflare-context TS module (createSupabaseServiceRoleClient() etc.) this
// plain-node script has no build step to import through. Keep this in sync
// by hand with templates.ts if that function's shape ever changes; there's
// exactly one other place this same "duplicated across a script and the
// app" tradeoff was made deliberately (ITR_GOV_MONITOR/cafocus's robots.ts).
//
// Usage (from this project's root, siringetbase/platform-core):
//   npm run template:apply -- --file=./draft-template.json --dry-run
//   npm run template:apply -- --file=./draft-template.json
//
// The --file JSON must have this shape (all fields required except
// changeReason):
//   {
//     "documentType": "form16",
//     "vertical": "cafocus",
//     "owningModule": "itr",
//     "prompt": "...",
//     "outputSchema": { "type": "object", "properties": { ... } },
//     "confidenceThreshold": 0.8,
//     "requiresHumanReview": true,
//     "maxTokens": 2048,
//     "changeReason": "Applied from itr_gov_change_alerts <id> — Form 16 gained a new Section 80CCH field per <source URL>"
//   }
//
// --dry-run prints what would change (or "new template, nothing to
// snapshot") without writing anything. Without it, this snapshots the
// existing row (if any) into extraction_templates_versions FIRST — same
// unconditional guarantee upsertExtractionTemplate() enforces in-app — then
// upserts.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function stripInlineComment(value) {
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    const end = value.indexOf(quote, 1);
    return end === -1 ? value.slice(1) : value.slice(1, end);
  }
  const hashIndex = value.search(/\s#/);
  return (hashIndex === -1 ? value : value.slice(0, hashIndex)).trim();
}

function loadEnvLocal() {
  const path = join(__dirname, "..", ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = stripInlineComment(trimmed.slice(eq + 1).trim());
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs() {
  const args = { dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg.startsWith("--file=")) {
      args.file = arg.slice("--file=".length).trim();
    }
  }
  return args;
}

function loadSpec(filePath) {
  const resolved = resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`No such file: ${resolved}`);
  }
  const spec = JSON.parse(readFileSync(resolved, "utf8"));
  const required = ["documentType", "vertical", "owningModule", "prompt", "outputSchema"];
  const missing = required.filter((k) => spec[k] === undefined || spec[k] === null || spec[k] === "");
  if (missing.length > 0) {
    throw new Error(`Spec file is missing required field(s): ${missing.join(", ")}`);
  }
  if (typeof spec.outputSchema !== "object" || Array.isArray(spec.outputSchema)) {
    throw new Error("outputSchema must be a JSON object.");
  }
  return {
    documentType: String(spec.documentType).trim(),
    vertical: String(spec.vertical).trim(),
    owningModule: String(spec.owningModule).trim(),
    prompt: String(spec.prompt),
    outputSchema: spec.outputSchema,
    // Same defaults app/api/admin/document-intelligence/extraction-templates/route.ts
    // falls back to, so a spec file that omits these behaves the same way
    // the admin form would.
    confidenceThreshold: typeof spec.confidenceThreshold === "number" ? spec.confidenceThreshold : 0.8,
    requiresHumanReview: typeof spec.requiresHumanReview === "boolean" ? spec.requiresHumanReview : true,
    maxTokens: typeof spec.maxTokens === "number" ? spec.maxTokens : 2048,
    changeReason: typeof spec.changeReason === "string" && spec.changeReason.trim() ? spec.changeReason.trim() : null,
  };
}

async function main() {
  loadEnvLocal();
  const args = parseArgs();

  if (!args.file) {
    console.error("Usage: npm run template:apply -- --file=./draft-template.json [--dry-run]");
    process.exit(1);
  }

  const spec = loadSpec(args.file);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — set them in the environment or in .env.local.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "siringetbase" },
    auth: { persistSession: false },
  });

  const { data: existing, error: fetchError } = await supabase
    .from("extraction_templates")
    .select(
      "id, document_type, vertical, owning_module, prompt, output_schema, confidence_threshold, requires_human_review, max_tokens"
    )
    .eq("document_type", spec.documentType)
    .eq("vertical", spec.vertical)
    .maybeSingle();
  if (fetchError) {
    console.error(`Lookup failed: ${fetchError.message}`);
    process.exit(1);
  }

  if (args.dryRun) {
    if (existing) {
      console.log(
        `DRY RUN — would snapshot the existing "${spec.documentType}"/"${spec.vertical}" template (id ${existing.id}) into extraction_templates_versions, then overwrite it with:`
      );
    } else {
      console.log(`DRY RUN — no existing "${spec.documentType}"/"${spec.vertical}" template; would INSERT a new one:`);
    }
    console.log(JSON.stringify(spec, null, 2));
    console.log("\nNothing written. Re-run without --dry-run to apply.");
    return;
  }

  if (existing) {
    const { error: versionError } = await supabase.from("extraction_templates_versions").insert({
      template_id: existing.id,
      document_type: existing.document_type,
      vertical: existing.vertical,
      owning_module: existing.owning_module,
      prompt: existing.prompt,
      output_schema: existing.output_schema,
      confidence_threshold: existing.confidence_threshold,
      requires_human_review: existing.requires_human_review,
      max_tokens: existing.max_tokens,
      versioned_by: null, // no role_profile — this ran outside an authenticated admin session
      change_reason: spec.changeReason ? `[cli] ${spec.changeReason}` : "[cli] apply-template.mjs, no change reason given",
    });
    // Same invariant as upsertExtractionTemplate(): a snapshot failure
    // blocks the overwrite, full stop.
    if (versionError) {
      console.error(`Could not snapshot existing template before saving over it: ${versionError.message}`);
      process.exit(1);
    }
  }

  const { data: saved, error: upsertError } = await supabase
    .from("extraction_templates")
    .upsert(
      {
        document_type: spec.documentType,
        vertical: spec.vertical,
        owning_module: spec.owningModule,
        prompt: spec.prompt,
        output_schema: spec.outputSchema,
        confidence_threshold: spec.confidenceThreshold,
        requires_human_review: spec.requiresHumanReview,
        max_tokens: spec.maxTokens,
      },
      { onConflict: "document_type,vertical" }
    )
    .select("id")
    .single();

  if (upsertError || !saved) {
    console.error(`Save failed: ${upsertError?.message ?? "unknown error"}`);
    process.exit(1);
  }

  console.log(
    existing
      ? `Updated "${spec.documentType}"/"${spec.vertical}" (id ${saved.id}). Prior version snapshotted — recoverable from /admin/document-intelligence's History panel.`
      : `Created new template "${spec.documentType}"/"${spec.vertical}" (id ${saved.id}).`
  );

  await supabase.from("admin_audit_log").insert({
    actor_email: null,
    actor_role: "cli",
    app: "platform-core",
    action: "document_intelligence.extraction_template.upsert",
    target_type: "extraction_template",
    target_id: saved.id,
    outcome: "success",
    detail: { document_type: spec.documentType, vertical: spec.vertical, change_reason: spec.changeReason, via: "scripts/apply-template.mjs" },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
