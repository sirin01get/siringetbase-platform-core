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
//
// Enterprise-gap fix: no security response headers previously — see
// cafocus/app/next.config.ts's identical block for the full reasoning
// (CSP directive choices, why 'unsafe-inline' instead of a nonce, why
// connect-src wildcards *.supabase.co). Same admin-console-only UI, same
// Supabase-project-sharing setup, so the same policy applies unchanged.
const isDev = process.env.NODE_ENV === "development";

const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data:;
  font-src 'self';
  connect-src 'self' https://*.supabase.co;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, " ")
  .trim();

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspHeader },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "X-XSS-Protection", value: "0" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
