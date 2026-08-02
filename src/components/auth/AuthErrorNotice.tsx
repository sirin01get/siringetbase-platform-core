"use client";

import { useEffect, useState } from "react";

interface Notice {
  code: string | null;
  description: string | null;
}

// Same mapping as cafocus/app's src/components/auth/AuthErrorNotice.tsx —
// see that file's header comment for the full story. Simplified for this
// app: there's only one sign-in form here (admin), so no role-aware CTA
// slot and no ReportIssueButton (this repo has no support-escalation UI —
// that's a cafocus/app-specific subsystem).
const FRIENDLY_MESSAGES: Record<string, string> = {
  otp_expired: "This sign-in link has expired or was already used.",
  access_denied: "This sign-in link has expired or was already used.",
  otp_disabled: "Email sign-in is temporarily unavailable. Please try again in a few minutes.",
};

function friendlyMessage({ code, description }: Notice): string {
  if (code && FRIENDLY_MESSAGES[code]) return FRIENDLY_MESSAGES[code];
  if (description && /expired|invalid|already.?used/i.test(description)) {
    return "This sign-in link has expired or was already used.";
  }
  return "We couldn't sign you in with that link.";
}

// Handles the same two landing spots cafocus/app's version does:
// Supabase's own error redirect (Site URL, query + hash fragment — note
// this Worker shares ONE Supabase project/Site URL with cafocus/app, so an
// expired platform-core-issued link's GoTrue-level bounce actually lands on
// cafocus.siringet.com's root, not here — this component's real job on
// this deployment is catching case 2) and this app's own
// app/auth/callback/route.ts redirecting a code-exchange failure back to
// /admin/login?error=<message>, which previously rendered nothing at all.
export default function AuthErrorNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const error = search.get("error") ?? hash.get("error");
    if (!error) return;

    setNotice({
      code: search.get("error_code") ?? hash.get("error_code"),
      description: search.get("error_description") ?? hash.get("error_description") ?? error,
    });

    const url = new URL(window.location.href);
    url.hash = "";
    ["error", "error_code", "error_description"].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, "", url.toString());
  }, []);

  if (!notice) return null;

  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="mt-0.5 h-4.5 w-4.5 flex-none text-amber-500"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-sm font-medium text-amber-900">{friendlyMessage(notice)}</p>
    </div>
  );
}
