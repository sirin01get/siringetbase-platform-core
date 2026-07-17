import neo4j, { type Driver } from "neo4j-driver";
import { env } from "@/config/env";

// Single driver instance per Worker isolate — neo4j-driver manages its own
// connection pool internally, so this should not be re-created per request.
// Credentials are Tier 1 secrets (../../security/README.md): Worker Secrets
// in production, .env.local for local dev, never in wrangler.jsonc.
let driver: Driver | null = null;

export function getNeo4jDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(env.neo4jUri(), neo4j.auth.basic(env.neo4jUser(), env.neo4jPassword()));
  }
  return driver;
}

// Cheap connectivity check for /api/diagnostics — verifyConnectivity() opens
// and closes a connection without running a real query.
export async function checkNeo4jConnectivity(): Promise<{ ok: boolean; error?: string }> {
  try {
    await getNeo4jDriver().verifyConnectivity();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
