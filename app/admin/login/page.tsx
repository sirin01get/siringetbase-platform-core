import type { Metadata } from "next";
import AdminSignInForm from "@/components/admin/AdminSignInForm";

export const metadata: Metadata = {
  title: "Admin sign-in — Siringet platform-core",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-12">
      <AdminSignInForm />
    </main>
  );
}
