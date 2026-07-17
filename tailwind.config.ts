import type { Config } from "tailwindcss";

// Minimal — siringetbase owns no product UI (see ../design-system/README.md:
// "any actual UI screens... every screen is vertical-owned"). This exists
// only in case a future internal admin/status page needs it; not meant to
// be the platform's Design System tokens, which live in ../design-system/.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
