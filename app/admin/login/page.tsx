import type { Metadata } from "next";
import AdminSignInForm from "@/components/admin/AdminSignInForm";

export const metadata: Metadata = {
  title: "Admin sign-in — Siringet platform-core",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <AdminSignInForm />
    </main>
  );
}
