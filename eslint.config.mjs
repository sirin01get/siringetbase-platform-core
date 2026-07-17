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
    ignores: [".next/**", ".open-next/**", "node_modules/**", "next-env.d.ts", "worker.ts"],
  },
];

export default eslintConfig;
