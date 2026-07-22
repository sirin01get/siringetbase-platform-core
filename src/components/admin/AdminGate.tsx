"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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

// Client-side gate for this app's /admin/* pages (billing, sync-queue) —
// mirrors cafocus/app's src/components/admin/AdminGate.tsx exactly (same
// GET /api/admin/whoami shape, same requireAdmin() backing it). Plain
// inline styles rather than Tailwind classes, matching this app's existing
// admin pages (billing/page.tsx, sync-queue/page.tsx were never built
// against the design-system component library cafocus/app uses).
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
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem" }}>
        <p>Checking your admin session…</p>
      </main>
    );
  }

  if (state.status === "wrong_role") {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
        <p style={{ color: "crimson" }}>
          Signed in as {state.admin.email ?? "an admin"} ({ROLE_LABEL[state.admin.role]}) — this page needs{" "}
          {(allowedRoles ?? []).map((r) => ROLE_LABEL[r]).join(" or ")}.
        </p>
        <a href="/admin/billing">Try billing</a> · <a href="/admin/sync-queue">Try sync queue</a>
      </main>
    );
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          background: "#111827",
          color: "#d1d5db",
          padding: "0.5rem 1.5rem",
          fontSize: "0.8rem",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <span>
          Signed in as <strong style={{ color: "#fff" }}>{state.admin.email ?? "—"}</strong> · {ROLE_LABEL[state.admin.role]}
          {state.admin.otherActiveRoles.length > 0 && (
            <span style={{ color: "#9ca3af" }}> (also: {state.admin.otherActiveRoles.map((r) => ROLE_LABEL[r]).join(", ")})</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          style={{ background: "none", border: "none", color: "#d1d5db", cursor: "pointer", textDecoration: "underline", fontSize: "0.8rem" }}
        >
          Sign out
        </button>
      </div>
      {children(state.admin)}
    </>
  );
}
