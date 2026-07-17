// Placeholder status page — Phase 0 proves the deployment pipeline, not a
// product. Real content: /api/health and /api/diagnostics.
export default function StatusPage() {
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
        </li>
        <li>
          <code>GET /api/diagnostics</code> — Supabase + Neo4j connection check
        </li>
        <li>
          <code>POST /api/payments/smoke-test</code> — exercises the mock payment gateway end to end
        </li>
      </ul>
    </main>
  );
}
