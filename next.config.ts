import type { NextConfig } from "next";

// Phase 0 note: kept intentionally minimal, same posture as homeai's Phase 1
// — this app has almost no UI (siringetbase owns no product screens per
// design-system/README.md), it exists to prove the deployment pipeline and
// host the identity/entity-graph/payments foundation.
//
// No webpack customization needed here. src/lib/document-intelligence/
// pdf-ocr.ts's PNG-encoder WASM binary (for the scanned-PDF OCR fallback)
// is imported as a checked-in base64 string constant
// (squoosh-png-wasm.generated.ts), not as a raw `.wasm` file — see that
// file's header comment for why a direct `.wasm` import kept failing here
// (two different webpack asset-handling approaches were tried and both hit
// real build errors, the second one traced to a Next.js-internal webpack
// generator-options default that this project can't safely override).
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
