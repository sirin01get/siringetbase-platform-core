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
    // model-gateway.ts, rate-limit.ts, benchmark.ts, and defer.ts are
    // excluded because each carries a genuine, necessary `// @ts-nocheck`
    // (getCloudflareContext()'s types collide with this project's "dom"
    // lib — see each file's own header comment) that
    // `@typescript-eslint/ban-ts-comment` bans outright, with no
    // `allow-with-description` override configured. File-level exclusion is
    // the existing pattern for this, not a rule-level exception — same fix
    // needed for rate-limit.ts's cafocus/app twin, tracked separately.
    // benchmark.ts's `// @ts-nocheck` broke a real Cloudflare Pages build
    // (`next build`'s lint step, not `tsc --noEmit`, which doesn't run
    // ESLint at all — that's why this wasn't caught before the deploy) the
    // first time it shipped without this exclusion; add any FUTURE file
    // that needs the same getCloudflareContext() workaround here too,
    // not just to tsconfig.json, or the same build failure repeats.
    ignores: [
      ".next/**",
      ".open-next/**",
      "node_modules/**",
      "next-env.d.ts",
      "worker.ts",
      "src/lib/document-intelligence/model-gateway.ts",
      "src/lib/document-intelligence/benchmark.ts",
      "src/lib/security/rate-limit.ts",
      "src/lib/comms/defer.ts",
    ],
  },
];

export default eslintConfig;
