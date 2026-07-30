import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";

const compat = new FlatCompat({
  baseDirectory: path.dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // worker.ts is excluded here too, same reason as tsconfig.json's
    // exclude: it imports ./.open-next/worker.js, which doesn't exist until
    // opennextjs-cloudflare build has run — linting it as part of the
    // TS-aware project (next/typescript) would fail on a module that
    // legitimately doesn't exist yet at lint time.
    //
    // model-gateway.ts and rate-limit.ts are excluded because both carry a
    // genuine, necessary `// @ts-nocheck` (getCloudflareContext()'s types
    // collide with this project's "dom" lib — see each file's own header
    // comment) that `@typescript-eslint/ban-ts-comment` bans outright, with
    // no `allow-with-description` override configured. File-level exclusion
    // is the existing pattern for this, not a rule-level exception — same
    // fix needed for rate-limit.ts's cafocus/app twin, tracked separately.
    ignores: [
      ".next/**",
      ".open-next/**",
      "node_modules/**",
      "next-env.d.ts",
      "worker.ts",
      "src/lib/document-intelligence/model-gateway.ts",
      "src/lib/security/rate-limit.ts",
    ],
  },
];

export default eslintConfig;
