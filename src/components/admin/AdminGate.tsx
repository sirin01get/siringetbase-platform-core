"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Spinner } from "./AdminUI";

export type AdminRole = "business_admin" | "support_admin";

interface WhoAmI {
  email: string | null;
  /** "Primary" role for display — cosmetic only, see /api/admin/whoami's header comment. */
  role: AdminRole;
  otherActiveRoles: AdminRole[];
  /** Full active role set — this is what authorization checks below use. */
  roles: AdminRole[];
}

const ROLE_LABEL: Record<AdminRole, string> = {
  business_admin: "Business admin",
  support_admin: "Support admin",
};

// Client-side gate for this app's /admin/* pages — mirrors cafocus/app's
// src/components/admin/AdminGate.tsx exactly (same GET /api/admin/whoami
// shape, same requireAdmin() backing it). Tailwind-styled (see ./AdminUI.tsx)
// to match the rest of this app's now-polished /admin/* surface.
export default function AdminGate({
  allowedRoles,
  children,
}: {
  allowedRoles?: AdminRole[];
  children: (admin: WhoAmI) => ReactNode;
}) {
  const [state, setState] = useState<
    | { status: "checking" }
    | { status: "signed_out" }
    | { status: "wrong_role"; admin: WhoAmI }
    | { status: "ok"; admin: WhoAmI }
  >({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/admin/whoami");
      if (cancelled) return;
      if (res.status === 401 || res.status === 403) {
        setState({ status: "signed_out" });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { status: string; admin?: WhoAmI };
      const admin = body.admin;
      if (body.status !== "ok" || !admin) {
        setState({ status: "signed_out" });
        return;
      }
      // Intersect against the FULL role set, not just the resolved
      // "primary" role — see /api/admin/whoami's header comment.
      if (allowedRoles && !allowedRoles.some((r) => admin.roles.includes(r))) {
        setState({ status: "wrong_role", admin });
        return;
      }
      setState({ status: "ok", admin });
    })();
    return () => {
      cancelled = true;
    };
  }, [allowedRoles]);

  useEffect(() => {
    if (state.status === "signed_out") {
      window.location.href = `/admin/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
  }, [state]);

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/admin/login";
  }

  if (state.status === "checking" || state.status === "signed_out") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-2.5 text-sm text-slate-500">
          <Spinner />
          Checking your admin session…
        </div>
      </main>
    );
  }

  if (state.status === "wrong_role") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-xl border border-rose-100 bg-white p-6 shadow-sm">
          <p className="text-sm text-rose-700">
            Signed in as <strong className="font-medium">{state.admin.email ?? "an admin"}</strong> (
            {ROLE_LABEL[state.admin.role]}) — this page needs{" "}
            {(allowedRoles ?? []).map((r) => ROLE_LABEL[r]).join(" or ")}.
          </p>
          <div className="mt-4 flex gap-4 text-sm font-medium text-slate-600">
            <a href="/admin/billing" className="hover:text-slate-900 hover:underline">
              Try billing
            </a>
            <a href="/admin/sync-queue" className="hover:text-slate-900 hover:underline">
              Try sync queue
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex items-center justify-between gap-3 bg-slate-900 px-6 py-2 text-xs text-slate-300">
        <span>
          Signed in as <strong className="font-semibold text-white">{state.admin.email ?? "—"}</strong> ·{" "}
          {ROLE_LABEL[state.admin.role]}
          {state.admin.otherActiveRoles.length > 0 && (
            <span className="text-slate-400">
              {" "}
              (also: {state.admin.otherActiveRoles.map((r) => ROLE_LABEL[r]).join(", ")})
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-slate-300 underline decoration-slate-600 underline-offset-2 transition hover:text-white"
        >
          Sign out
        </button>
      </div>
      {children(state.admin)}
    </div>
  );
}
