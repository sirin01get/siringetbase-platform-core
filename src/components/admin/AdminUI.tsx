import type { ReactNode } from "react";

// Shared Tailwind building blocks for this app's /admin/* screens.
//
// Until now this app's admin surface was deliberately narrow/minimal — see
// each page's own header comment — built with raw inline styles, not
// cafocus/app's design system. That was a fine tradeoff while there were
// two screens (billing, sync-queue). It stopped being one once env-check,
// document-intelligence, and the polished AdminSignInForm.tsx all landed
// with their own one-off styling. This file is the small, shared set of
// primitives (card, table cell, badge, button, input) every /admin/* page
// now builds on, so a change to "what does professional look like here"
// happens in one place instead of five.
//
// Palette matches AdminSignInForm.tsx / AdminGate.tsx's top bar: slate for
// structure/text, emerald for success, rose for failure, amber for
// warning/caution, plain slate-100 for neutral/inactive.

export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {description && <div className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">{description}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/40 ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeading({
  children,
  subtitle,
  className = "",
}: {
  children: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <h2 className="text-base font-semibold text-slate-900">{children}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

type BadgeTone = "green" | "red" | "amber" | "slate";

const badgeTones: Record<BadgeTone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  red: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
  amber: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
  slate: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/10",
};

export function Badge({ tone, children, title }: { tone: BadgeTone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

type BannerTone = "red" | "green" | "amber";

const bannerTones: Record<BannerTone, string> = {
  red: "border-rose-100 bg-rose-50 text-rose-700",
  green: "border-emerald-100 bg-emerald-50 text-emerald-700",
  amber: "border-amber-100 bg-amber-50 text-amber-800",
};

export function Banner({ tone, children, className = "" }: { tone: BannerTone; children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border px-4 py-3 text-sm ${bannerTones[tone]} ${className}`}>{children}</div>;
}

export const buttonPrimary =
  "inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonSecondary =
  "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonGhost =
  "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";

export const inputClass =
  "block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100";

export const labelClass = "block text-sm font-medium text-slate-700";
export const hintClass = "font-normal text-slate-400";

export const th = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
export const td = "px-4 py-2.5 align-top text-sm text-slate-700";
export const trBody = "border-t border-slate-100 transition hover:bg-slate-50/70";

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-4 w-4 animate-spin text-current ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
