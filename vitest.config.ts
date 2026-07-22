import { defineConfig } from "vitest/config";
import path from "node:path";

// Test lanes per GLOBAL/05 §A: unit + contract tests run on every CI cycle
// (npm test). RLS and capability lanes run against a migrated local
// Supabase and are wired separately in CI (they need the supabase CLI).
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@app": path.resolve(__dirname, "app"),
    },
  },
});
