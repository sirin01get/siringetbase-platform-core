import type { NextConfig } from "next";

// Phase 0 note: kept intentionally minimal, same posture as homeai's Phase 1
// — this app has almost no UI (siringetbase owns no product screens per
// design-system/README.md), it exists to prove the deployment pipeline and
// host the identity/entity-graph/payments foundation.
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
