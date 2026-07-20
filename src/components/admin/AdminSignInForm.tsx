"use client";

import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Magic-link sign-in for business_admin/support_admin accounts — mirrors
// cafocus/app's src/components/admin/AdminSignInForm.tsx exactly. Signing
// in here does NOT make someone an admin — only creates/authenticates
// their auth.users row; the business_admin/support_admin role_profile is
// provisioned separately (see README.md "Access control"). Same shared
// siringetbase.role_profiles table cafocus/app checks, so an account
// granted the role in one app is recognized in both — each just needs its
// own sign-in, since sessions don't cross origins.
export default function AdminSignInForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const next = new URLSearchParams(window.location.search).get("next") || "/admin/billing";
    const redirectUrl = new URL("/auth/callback", window.location.origin);
    redirectUrl.searchParams.set("next", next);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectUrl.toString() },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 360, border: "1px solid #ddd", borderRadius: 8, padding: "1.5rem" }}>
      {status === "sent" ? (
        <>
          <h2>Check your inbox</h2>
          <p style={{ color: "#555" }}>
            We sent a sign-in link to <strong>{email}</strong>. Open it on this device to come back here signed
            in. If this email doesn&rsquo;t have an admin role attached yet, you&rsquo;ll land signed in but not
            authorized — that&rsquo;s expected until an operator grants the role.
          </p>
        </>
      ) : (
        <>
          <h2>Admin sign-in</h2>
          <p style={{ color: "#555" }}>
            Business admin and support admin accounts only. No self-registration — access is granted directly,
            not by signing in here.
          </p>
          <form onSubmit={(e) => void handleSubmit(e)}>
            <label style={{ display: "block", marginBottom: "0.75rem" }}>
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ display: "block", width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
              />
            </label>
            <button type="submit" disabled={status === "sending"} style={{ width: "100%", padding: "0.6rem" }}>
              {status === "sending" ? "Sending…" : "Send sign-in link"}
            </button>
            {status === "error" && errorMessage && <p style={{ color: "crimson" }}>{errorMessage}</p>}
          </form>
        </>
      )}
    </div>
  );
}
