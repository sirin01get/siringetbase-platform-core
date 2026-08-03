"use client";

import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useResendTimer } from "@/hooks/useResendTimer";
import AuthErrorNotice from "@/components/auth/AuthErrorNotice";

// Magic-link sign-in for business_admin/support_admin accounts. Signing in
// here does NOT make someone an admin — only creates/authenticates their
// auth.users row; the business_admin/support_admin role_profile is
// provisioned separately (see README.md "Access control"). Same shared
// siringetbase.role_profiles table cafocus/app checks, so an account
// granted the role in one app is recognized in both — each just needs its
// own sign-in, since sessions don't cross origins.
//
// Brought up to parity with cafocus/app's src/components/admin/AdminSignInForm.tsx
// (previously just a bare `1px solid #ddd` box with inline styles and no
// resend/recovery path at all — see that repo's version for the full
// rationale behind each piece ported here): Tailwind card treatment,
// resend-with-cooldown timer, a 6-digit code fallback for when the link
// itself doesn't work (mail scanners burning the single-use code before a
// human clicks it), and AuthErrorNotice for a graceful expired-link message
// instead of a raw querystring.
// supabase.auth.signInWithOtp()/verifyOtp() have no built-in timeout — a
// slow or stalled connection to Supabase's auth email relay leaves the UI
// stuck on "Sending…"/"Verifying…" forever with no error ever surfacing.
// Same failure class already fixed elsewhere in this codebase (retry.ts's
// AbortController + FETCH_TIMEOUT_MS, model-gateway.ts's withTimeout()
// around env.AI calls) — applied here via a plain Promise.race since the
// supabase-js client methods don't accept an AbortSignal.
const AUTH_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

export default function AdminSignInForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeStatus, setCodeStatus] = useState<"idle" | "verifying" | "error">("idle");
  const [codeError, setCodeError] = useState<string | null>(null);
  const resendTimer = useResendTimer();
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "error">("idle");
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  async function sendLink(): Promise<{ error: string | null }> {
    const next = new URLSearchParams(window.location.search).get("next") || "/admin/billing";
    const redirectUrl = new URL("/auth/callback", window.location.origin);
    redirectUrl.searchParams.set("next", next);

    const supabase = createSupabaseBrowserClient();
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectUrl.toString() },
        }),
        AUTH_TIMEOUT_MS,
        "Sending the sign-in email timed out. Check your connection and try again."
      );

      return { error: error?.message ?? null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Something went wrong sending the sign-in email." };
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const { error } = await sendLink();

    if (error) {
      setStatus("error");
      setErrorMessage(error);
      return;
    }

    setStatus("sent");
    resendTimer.start();
  }

  async function handleResend() {
    setResendStatus("sending");
    setResendMessage(null);

    const { error } = await sendLink();

    if (error) {
      setResendStatus("error");
      setResendMessage(error);
      return;
    }

    setResendStatus("idle");
    setResendMessage("Sent again — check your inbox.");
    resendTimer.start();
  }

  function handleUseDifferentEmail() {
    setStatus("idle");
    setErrorMessage(null);
    setCode("");
    setCodeStatus("idle");
    setCodeError(null);
    setResendStatus("idle");
    setResendMessage(null);
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    setCodeStatus("verifying");
    setCodeError(null);

    const supabase = createSupabaseBrowserClient();
    try {
      const { error } = await withTimeout(
        supabase.auth.verifyOtp({ email, token: code, type: "email" }),
        AUTH_TIMEOUT_MS,
        "Verifying the code timed out. Check your connection and try again."
      );

      if (error) {
        setCodeStatus("error");
        setCodeError(error.message);
        return;
      }
    } catch (err) {
      setCodeStatus("error");
      setCodeError(err instanceof Error ? err.message : "Something went wrong verifying the code.");
      return;
    }

    const next = new URLSearchParams(window.location.search).get("next") || "/admin/billing";
    window.location.href = next;
  }

  return (
    <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50">
      <div className="p-8">
        <AuthErrorNotice />

        {status === "sent" ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
                <path d="M4 12.5l5 5L20 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Check your inbox</h2>
            <p className="mt-2 text-sm text-slate-600">
              We sent a sign-in link to <strong className="font-medium text-slate-900">{email}</strong>. Open it
              on this device to come back here signed in. If this email doesn&rsquo;t have an admin role attached
              yet, you&rsquo;ll land signed in but not authorized — that&rsquo;s expected until an operator grants
              the role.
            </p>

            <div className="mt-4 flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleResend()}
                disabled={!resendTimer.canResend || resendStatus === "sending"}
                className="text-sm font-semibold text-slate-900 transition hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {resendStatus === "sending"
                  ? "Resending…"
                  : resendTimer.canResend
                    ? "Resend the email"
                    : `Resend available in ${resendTimer.formatted}`}
              </button>
              {resendStatus === "error" && resendMessage ? (
                <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{resendMessage}</div>
              ) : (
                resendMessage && <p className="text-xs text-emerald-600">{resendMessage}</p>
              )}
              <button
                type="button"
                onClick={handleUseDifferentEmail}
                className="mt-1 text-xs text-slate-400 underline decoration-slate-300 underline-offset-2 hover:text-slate-600"
              >
                Wrong address? Use a different email
              </button>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-6 text-left">
              <p className="text-sm text-slate-600">
                Link not working, or keeps sending you back here? Enter the 6-digit code from the same
                email instead.
              </p>
              <form onSubmit={(e) => void handleVerifyCode(e)} className="mt-3 flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-center tracking-widest text-slate-900 placeholder-slate-400 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100"
                />
                <button
                  type="submit"
                  disabled={codeStatus === "verifying" || !code}
                  className="flex-1 rounded-lg border border-slate-900 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {codeStatus === "verifying" ? "Verifying…" : "Verify code"}
                </button>
              </form>
              {codeStatus === "error" && codeError && (
                <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{codeError}</div>
              )}
            </div>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-slate-900">Admin sign-in</h2>
            <p className="mt-1 text-sm text-slate-500">
              Business admin and support admin accounts only. No self-registration — access is granted directly,
              not by signing in here.
            </p>

            <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@yourcompany.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 placeholder-slate-400 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100"
                />
              </div>

              <button
                type="submit"
                disabled={status === "sending"}
                className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "sending" ? "Sending…" : "Send sign-in link"}
              </button>

              {status === "error" && errorMessage && (
                <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</div>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
