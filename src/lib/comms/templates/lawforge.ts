// LawForge's own email copy — comms owns the pipeline/registry, LawForge
// (the vertical) owns what these say, per ../../../../comms/README.md's
// "The Boundary Rule". Brand colors match lawforge/app's own palette
// (#292929 ink / #585858 muted / #ffc815 accent / #ffffff / #000000 — see
// lawforge/app/README.md's brand section) so the email doesn't look like a
// different product from the sign-in page it follows.
//
// Registered into ../templates/registry.ts under vertical "lawforge",
// role "lawyer".
//
// Contrast note: #ffc815 on white fails WCAG AA for text (~1.6:1) — every
// use below keeps the raw accent color to *backgrounds* only (button fill,
// the eyebrow badge, the footer tint) and pairs it with #292929 ink on top,
// never as a text color on white. Same tradeoff cafocus/app's ca.ts header
// comment flags for its own brand-700 pick, solved the same way CA Focus's
// sign-in button already does it (dark text on the accent fill).

import type { RenderedEmail, TemplateRenderer } from "../types";
import { emailShell, escapeHtml } from "./shared";

const BRAND = "#ffc815";
const INK = "#292929";
const MUTED = "#585858";
const FOOTER_BG = "#fff7da";

// Small pill-badge eyebrow, background = accent, text = ink — this is the
// one place raw BRAND carries text, and it's safe because the text sits on
// the accent fill, not on white.
function eyebrowBadge(): string {
  return `<p style="display:inline-block;margin:0 0 16px;padding:4px 10px;border-radius:999px;background:${BRAND};font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${INK};">
    LawForge
  </p>`;
}

function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0">
    <tr>
      <td style="border-radius:10px;background:${BRAND};">
        <a href="${escapeHtml(href)}"
           style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:${INK};text-decoration:none;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

function footer(): string {
  return `<tr>
    <td style="padding:20px 32px;background:${FOOTER_BG};border-top:1px solid #ffe999;">
      <p style="margin:0;font-size:12px;color:${INK};">
        Documents, deadlines, and verified engagements — LawForge, part of the Siringet platform.
      </p>
    </td>
  </tr>`;
}

function authMagicLink(data: Record<string, unknown>): RenderedEmail {
  const confirmationUrl = String(data.confirmationUrl ?? "");
  const backupCode = data.token ? String(data.token) : null;

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        ${eyebrowBadge()}
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK};">
          Your sign-in link
        </h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${MUTED};">
          Use the button below to sign in to LawForge — your practice's client workspace for
          branding, document handling, and case work.
        </p>
        ${ctaButton(confirmationUrl, "Sign in to LawForge")}
        ${
          backupCode
            ? `<p style="margin:24px 0 0;font-size:13px;color:${MUTED};">
                 Button not working? Use this one-time code instead: <strong style="color:${INK};letter-spacing:0.06em;">${escapeHtml(backupCode)}</strong>
               </p>`
            : ""
        }
        <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
          This link expires shortly and can only be used once. If you didn't request it, you can
          safely ignore this email — no account changes were made.
        </p>
      </td>
    </tr>
    ${footer()}`;

  return {
    subject: "Your LawForge sign-in link",
    html: emailShell({ previewText: "Sign in to LawForge", bodyHtml }),
    text: `Sign in to LawForge: ${confirmationUrl}${backupCode ? `\n\nOr use this one-time code: ${backupCode}` : ""}\n\nThis link expires shortly and can only be used once. If you didn't request it, you can safely ignore this email.`,
  };
}

// Sent from lawforge/app's app/api/admin/lawyer-verifications/[id]/route.ts
// on a business_admin's approve decision — same
// notify-after-the-decision-is-already-recorded, best-effort posture as
// cafocus/app's src/lib/ca/verification-decision.ts.
function verificationApproved(data: Record<string, unknown>): RenderedEmail {
  const signInUrl = String(data.signInUrl ?? "");
  const firmName = data.firmName ? String(data.firmName) : null;

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        ${eyebrowBadge()}
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK};">
          You're verified${firmName ? `, ${escapeHtml(firmName)}` : ""}
        </h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${MUTED};">
          Your LawForge practice has been reviewed and verified. Your client-facing branded space
          is live — set up your firm name, logo, and colors if you haven't already.
        </p>
        ${signInUrl ? ctaButton(signInUrl, "Go to LawForge") : ""}
      </td>
    </tr>
    ${footer()}`;

  return {
    subject: "You're verified on LawForge",
    html: emailShell({ previewText: "Your LawForge practice is verified", bodyHtml }),
    text: `You're verified on LawForge.\n\nYour practice has been reviewed and verified — your client-facing branded space is live.${signInUrl ? `\n\nSign in: ${signInUrl}` : ""}`,
  };
}

function verificationRejected(data: Record<string, unknown>): RenderedEmail {
  const signInUrl = String(data.signInUrl ?? "");
  const rejectionReason = data.rejectionReason ? String(data.rejectionReason) : "Not specified";

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        ${eyebrowBadge()}
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK};">
          Update on your verification
        </h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${MUTED};">
          We weren't able to verify your LawForge practice this time.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border-radius:10px;margin:0 0 24px;">
          <tr>
            <td style="padding:14px 16px;font-size:14px;color:#334155;">
              ${escapeHtml(rejectionReason)}
            </td>
          </tr>
        </table>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${MUTED};">
          This isn't final — you can update your details and resubmit whenever you're ready, and
          most resubmissions are reviewed quickly.
        </p>
        ${signInUrl ? ctaButton(signInUrl, "Resubmit on LawForge") : ""}
      </td>
    </tr>
    ${footer()}`;

  return {
    subject: "Update on your LawForge verification",
    html: emailShell({ previewText: "Update on your LawForge verification", bodyHtml }),
    text: `Update on your LawForge verification.\n\nWe weren't able to verify your practice this time.\n\nReason: ${rejectionReason}\n\nThis isn't final — you can update your details and resubmit whenever you're ready, and most resubmissions are reviewed quickly.${signInUrl ? `\n\n${signInUrl}` : ""}`,
  };
}

export const LAWFORGE_TEMPLATES: Record<string, TemplateRenderer> = {
  "auth.magic_link": authMagicLink,
  "verification.approved": verificationApproved,
  "verification.rejected": verificationRejected,
};
