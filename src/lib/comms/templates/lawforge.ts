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

// Sent from lawforge/app's src/lib/clients/store.ts's inviteClient(), via
// auth.admin.inviteUserByEmail() — GoTrue's "invite" action type
// (auth-email-hook/route.ts's TRIGGER_EVENT_MAP maps it to "auth.invite").
// `practiceName` comes through as user_metadata (that route's own
// spread-user_metadata-into-templateData comment explains why), not a
// normal template-call argument — falls back to generic copy if it's ever
// missing rather than printing "undefined". This is the branded LawForge
// counterpart to ../fallback.ts's authInvite(): that generic version is
// what a brand-new business_admin invite still falls through to (no
// practice_name to merge for that role), this one is what a client invite
// actually renders once registered under role 'client' in ../registry.ts.
function authInvite(data: Record<string, unknown>): RenderedEmail {
  const confirmationUrl = String(data.confirmationUrl ?? "");
  const backupCode = data.token ? String(data.token) : null;
  const practiceName = data.practice_name ? String(data.practice_name) : null;

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        ${eyebrowBadge()}
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK};">
          You&rsquo;ve been invited${practiceName ? ` by ${escapeHtml(practiceName)}` : ""}
        </h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${MUTED};">
          ${practiceName ? escapeHtml(practiceName) : "Your lawyer"} has set up a LawForge client space for
          you — a place to send and receive documents for your matter. Use the button below to accept
          and sign in, no password needed.
        </p>
        ${ctaButton(confirmationUrl, "Accept invite")}
        ${
          backupCode
            ? `<p style="margin:24px 0 0;font-size:13px;color:${MUTED};">
                 Button not working? Use this one-time code instead: <strong style="color:${INK};letter-spacing:0.06em;">${escapeHtml(backupCode)}</strong>
               </p>`
            : ""
        }
        <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
          This link expires shortly and can only be used once. If you weren't expecting this, you can
          safely ignore this email.
        </p>
      </td>
    </tr>
    ${footer()}`;

  return {
    subject: practiceName ? `${practiceName} invited you to LawForge` : "You've been invited to LawForge",
    html: emailShell({ previewText: "You've been invited to a LawForge client space", bodyHtml }),
    text: `${practiceName ? `${practiceName} has invited you` : "You've been invited"} to a LawForge client space — a place to send and receive documents for your matter.\n\nAccept your invite and sign in: ${confirmationUrl}${backupCode ? `\n\nOr use this one-time code: ${backupCode}` : ""}\n\nThis link expires shortly and can only be used once. If you weren't expecting this, you can safely ignore this email.`,
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

// Deadline reminder — sent by lawforge/app's own Cron Trigger sweep
// (src/lib/matters/deadline-reminders.ts there, run from its worker.ts),
// not by any user action, so unlike every other template in this file
// there's no "you just did something" context to anchor it. One email per
// lawyer per sweep covering all their due matters, rather than one per
// matter — a lawyer with six deadlines landing the same week should get one
// digest, not six separate emails.
//
// `matters` arrives as an array of plain objects rather than pre-rendered
// text so the copy stays owned here (comms/README.md's Boundary Rule)
// rather than in the vertical's sweep code. Defensively narrowed: this
// renderer is reachable from a DB-override tier too (see
// ../registry.ts's getTemplate()), so it can't assume the shape it gets.
function matterDeadlineReminder(data: Record<string, unknown>): RenderedEmail {
  const signInUrl = String(data.signInUrl ?? "");
  const rawMatters = Array.isArray(data.matters) ? data.matters : [];

  const matters = rawMatters.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      title: String(row.title ?? "Untitled matter"),
      clientEmail: row.clientEmail ? String(row.clientEmail) : null,
      nextDeadline: String(row.nextDeadline ?? ""),
      nextAction: row.nextAction ? String(row.nextAction) : null,
    };
  });

  const count = matters.length;
  const heading = count === 1 ? "1 matter needs attention" : `${count} matters need attention`;

  const rowsHtml = matters
    .map(
      (m) => `<tr>
        <td style="padding:12px 16px;border-bottom:1px solid #e8e8e8;">
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:${INK};">${escapeHtml(m.title)}</p>
          <p style="margin:0;font-size:13px;color:${MUTED};">
            Due ${escapeHtml(m.nextDeadline)}${m.clientEmail ? ` &middot; ${escapeHtml(m.clientEmail)}` : ""}
          </p>
          ${m.nextAction ? `<p style="margin:6px 0 0;font-size:13px;color:${INK};">Next: ${escapeHtml(m.nextAction)}</p>` : ""}
        </td>
      </tr>`
    )
    .join("");

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        ${eyebrowBadge()}
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK};">
          ${escapeHtml(heading)}
        </h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${MUTED};">
          These have a deadline coming up or already past. Nothing has been sent to your clients —
          this reminder is for you only.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#fafafa;border-radius:10px;margin:0 0 24px;">
          ${rowsHtml}
        </table>
        ${signInUrl ? ctaButton(signInUrl, "Open LawForge") : ""}
      </td>
    </tr>
    ${footer()}`;

  const textLines = matters
    .map((m) => `- ${m.title} — due ${m.nextDeadline}${m.nextAction ? ` (next: ${m.nextAction})` : ""}`)
    .join("\n");

  return {
    subject: count === 1 ? "1 LawForge matter needs attention" : `${count} LawForge matters need attention`,
    html: emailShell({ previewText: heading, bodyHtml }),
    text: `${heading}.\n\nThese have a deadline coming up or already past. Nothing has been sent to your clients — this reminder is for you only.\n\n${textLines}${signInUrl ? `\n\n${signInUrl}` : ""}`,
  };
}

export const LAWFORGE_TEMPLATES: Record<string, TemplateRenderer> = {
  "auth.magic_link": authMagicLink,
  "auth.invite": authInvite,
  "verification.approved": verificationApproved,
  "verification.rejected": verificationRejected,
  "matter.deadline_reminder": matterDeadlineReminder,
};
