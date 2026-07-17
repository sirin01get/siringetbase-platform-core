import type { Metadata } from "next";
import "./globals.css";

// This app has almost no UI on purpose — siringetbase is a platform-core
// service (identity, entity graph sync, payments primitives), not a
// product. See ../README.md and ../design-system/README.md: "any actual
// UI screens... every screen is vertical-owned." This root layout exists
// to host a placeholder status page and API routes, nothing more.
export const metadata: Metadata = {
  title: "Siringetbase — Platform Core",
  description: "Identity, Entity Graph, and Payments foundation shared by every Siringetbase vertical.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
