import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Phase 0: default config, matching homeai/homeai's pattern. Nothing here
// yet needs a tuned caching strategy — this app is API routes, not pages.
export default defineCloudflareConfig();
