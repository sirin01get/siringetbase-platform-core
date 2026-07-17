import { headers } from "next/headers";

// Placeholder status page — Phase 0 proves the deployment pipeline, not a
// product. Real content: /api/health and /api/diagnostics.
export default async function StatusPage() {
  // Resolved from the incoming request's own headers rather than a
  // hardcoded/env-based URL — so this is correct whether it's reached via
  // the production domain, a per-deployment preview URL
  // (<hash>-siringetbase-platform-core.workers.dev), or localhost in local
  // dev, with no client-side JS needed.
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  const origin = `${protocol}://${host}`;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>Siringetbase Platform Core</h1>
      <p>
        Identity, Entity Graph, and Payments foundation. Not a product — every
        screen a user sees lives in a vertical (CA Focus, Build Focus, ...),
        built from the shared <code>design-system</code>.
      </p>
      <ul>
        <li>
          <code>GET /api/health</code> — liveness check
          <br />
          <a href={`${origin}/api/health`}>{origin}/api/health</a>
        </li>
        <li>
          <code>GET /api/diagnostics</code> — Supabase + Neo4j connection check
          <br />
          <a href={`${origin}/api/diagnostics`}>{origin}/api/diagnostics</a>
        </li>
        <li>
          <code>POST /api/payments/smoke-test</code> — exercises the mock payment gateway end to
          end. Requires a POST request (visiting this URL directly returns 405 — see{" "}
          <code>README.md</code>'s Local development section for a working <code>curl</code>{" "}
          example):
          <br />
          <code>{origin}/api/payments/smoke-test</code>
        </li>
        <li>
          <a href={`${origin}/admin/sync-queue`}>{origin}/admin/sync-queue</a> — admin view of unsynced
          entity_sync_queue rows (dead-lettered, legacy failed, or still backing off), with a manual
          retry-and-push action.
        </li>
      </ul>
    </main>
  );
}
