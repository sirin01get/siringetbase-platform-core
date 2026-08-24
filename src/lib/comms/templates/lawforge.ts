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

  // The vertical's own client sign-in page, so an expired invite isn't a dead
  // end (2026-08-23). Supabase caps OTP/invite validity at 24 hours and won't
  // allow longer, so an invite opened two days later WILL be expired — but the
  // client's account already exists by then, and they can just request a fresh
  // code. Saying so here is the actual fix for "the invite expired"; extending
  // the token isn't possible.
  //
  // Derived from confirmationUrl's own redirect_to rather than data.siteUrl:
  // siteUrl is the shared Supabase project's Site URL, which points at a
  // DIFFERENT vertical (cafocus) and would send LawForge clients to the wrong
  // app entirely. Falls back to no link rather than a wrong one.
  let signInUrl: string | null = null;
  try {
    const redirectTo = new URL(confirmationUrl).searchParams.get("redirect_to");
    if (redirectTo) signInUrl = `${new URL(redirectTo).origin}/client/login`;
  } catch {
    // Malformed or absent — the copy below simply omits the link.
  }

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
          This link expires within 24 hours and can only be used once — but your space doesn&rsquo;t go
          anywhere.${
            signInUrl
              ? ` If it&rsquo;s already expired, <a href="${escapeHtml(signInUrl)}" style="color:${INK};">sign in with this email address</a> and we&rsquo;ll send you a fresh code.`
              : " If it&rsquo;s already expired, just sign in with this email address and we&rsquo;ll send you a fresh code."
          }
        </p>
        <p style="margin:12px 0 0;font-size:13px;color:#94a3b8;">
          If you weren&rsquo;t expecting this, you can safely ignore this email.
        </p>
      </td>
    </tr>
    ${footer()}`;

  return {
    subject: practiceName ? `${practiceName} invited you to LawForge` : "You've been invited to LawForge",
    html: emailShell({ previewText: "You've been invited to a LawForge client space", bodyHtml }),
    text: `${practiceName ? `${practiceName} has invited you` : "You've been invited"} to a LawForge client space — a place to send and receive documents for your matter.\n\nAccept your invite and sign in: ${confirmationUrl}${backupCode ? `\n\nOr use this one-time code: ${backupCode}` : ""}\n\nThis link expires within 24 hours and can only be used once — but your space doesn't go anywhere. If it's already expired, sign in with this email address${signInUrl ? ` at ${signInUrl}` : ""} and we'll send you a fresh code.\n\nIf you weren't expecting this, you can safely ignore this email.`,
  };
}

// Sent from lawforge/app's app/api/admin/lawyer-verifications/[id]/route.ts
// on a business_admin's approve decision — same
// notify-after-the-decision-is-already-recorded, best-effort posture as
// cafocus/app's src/lib/ca/verification-decision.ts.
// Rewritten 2026-08-16 — the previous version was two sentences and a
// button. It confirmed the decision but did nothing with the moment: this
// is the one email in the whole flow that arrives as good news, after a
// lawyer submitted credentials and then waited on a manual review with no
// visibility into it.
//
// Tone: congratulatory, not effusive. The audience is a practising lawyer
// receiving a professional credentialing outcome — "Congratulations" and a
// warm close land well; exclamation marks and marketing superlatives read
// as unserious and would undercut the fact that a real person reviewed
// their bar credentials.
//
// Structure follows what someone actually needs on being unblocked: the
// decision, what's now open to them, and the first three concrete things to
// do — because "you're verified" without a next step just moves the
// question from "am I approved?" to "so now what?".
function verificationApproved(data: Record<string, unknown>): RenderedEmail {
  const signInUrl = String(data.signInUrl ?? "");
  const firmName = data.firmName ? String(data.firmName) : null;

  // Numbered steps rather than prose: this is a checklist someone works
  // through in their first session, and a paragraph would bury it.
  const steps = [
    {
      title: "Make it yours",
      body: "Set your firm name, logo, and colours. Your clients see your practice — LawForge stays out of the way.",
    },
    {
      title: "Invite your first client",
      body: "They get their own branded space, with documents you can both see and matters they can follow.",
    },
    {
      title: "Add your colleagues",
      body: "Associates get their own sign-in and can take on client work straight away.",
    },
  ];

  const stepsHtml = steps
    .map(
      (s, i) => `<tr>
        <td style="padding:0 0 14px;" valign="top">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td width="28" valign="top">
                <div style="width:22px;height:22px;border-radius:11px;background:${BRAND};text-align:center;font-size:12px;font-weight:700;line-height:22px;color:${INK};">${i + 1}</div>
              </td>
              <td valign="top">
                <p style="margin:0 0 2px;font-size:15px;font-weight:600;color:${INK};">${escapeHtml(s.title)}</p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:${MUTED};">${escapeHtml(s.body)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    )
    .join("");

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        ${eyebrowBadge()}
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK};">
          You're verified${firmName ? `, ${escapeHtml(firmName)}` : ""} — congratulations
        </h1>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${MUTED};">
          We've reviewed your credentials and your practice is now live on LawForge. Everything is
          open to you: your branded client space, shared documents, matters and deadlines,
          consultation requests, and document preparation.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${MUTED};">
          Here's where most practices start:
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px;">
          ${stepsHtml}
        </table>
        ${signInUrl ? ctaButton(signInUrl, "Open your practice") : ""}
        <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:${MUTED};">
          If anything doesn't look right, reply to this email — a person reads it.
        </p>
      </td>
    </tr>
    ${footer()}`;

  const textSteps = steps.map((s, i) => `${i + 1}. ${s.title} — ${s.body}`).join("\n");

  return {
    subject: firmName ? `${firmName} is verified on LawForge` : "You're verified on LawForge",
    html: emailShell({ previewText: "Your practice is verified — here's how to get started", bodyHtml }),
    text: `You're verified${firmName ? `, ${firmName}` : ""} — congratulations.\n\nWe've reviewed your credentials and your practice is now live on LawForge. Everything is open to you: your branded client space, shared documents, matters and deadlines, consultation requests, and document preparation.\n\nHere's where most practices start:\n\n${textSteps}${signInUrl ? `\n\nOpen your practice: ${signInUrl}` : ""}\n\nIf anything doesn't look right, reply to this email — a person reads it.`,
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

// Sent whenever an item's ACTION OWNER changes hands between a lawyer and a
// client — a document requested, paperwork sent back, a consultation
// answered, a draft delivered. One template rather than one per event,
// because from the recipient's side every one of them is the same message:
// "this is now yours, here's what to do, here's the link."
//
// That also keeps the email consistent with the in-app ownership model
// (lawforge/app's src/lib/workflow/ownership.ts): exactly one owner, an
// instruction phrased to them, and how long it's been waiting. A per-event
// template set would drift from that vocabulary within a release or two.
//
// Addressed to whoever now owns the action, which may be the lawyer or the
// client — so the copy never assumes which. `actorName` is who caused it
// ("Your lawyer", or the firm's name), `nextAction` is the instruction.
function workflowActionNeeded(data: Record<string, unknown>): RenderedEmail {
  const headline = String(data.headline ?? "Something needs your attention");
  const itemTitle = data.itemTitle ? String(data.itemTitle) : null;
  const nextAction = String(data.nextAction ?? "");
  const contextLine = data.contextLine ? String(data.contextLine) : null;
  const actionUrl = String(data.actionUrl ?? "");
  const ctaLabel = String(data.ctaLabel ?? "Open LawForge");

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        ${eyebrowBadge()}
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK};">
          ${escapeHtml(headline)}
        </h1>
        ${
          itemTitle
            ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#fafafa;border-radius:10px;margin:0 0 20px;">
                 <tr>
                   <td style="padding:14px 16px;">
                     <p style="margin:0;font-size:15px;font-weight:600;color:${INK};">${escapeHtml(itemTitle)}</p>
                     ${contextLine ? `<p style="margin:4px 0 0;font-size:13px;color:${MUTED};">${escapeHtml(contextLine)}</p>` : ""}
                   </td>
                 </tr>
               </table>`
            : ""
        }
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${MUTED};">
          <strong style="color:${INK};">What's next:</strong> ${escapeHtml(nextAction)}
        </p>
        ${actionUrl ? ctaButton(actionUrl, ctaLabel) : ""}
      </td>
    </tr>
    ${footer()}`;

  return {
    subject: itemTitle ? `${headline}: ${itemTitle}` : headline,
    html: emailShell({ previewText: nextAction || headline, bodyHtml }),
    text: `${headline}\n\n${itemTitle ? `${itemTitle}\n` : ""}${contextLine ? `${contextLine}\n` : ""}\nWhat's next: ${nextAction}${actionUrl ? `\n\n${ctaLabel}: ${actionUrl}` : ""}`,
  };
}

export const LAWFORGE_TEMPLATES: Record<string, TemplateRenderer> = {
  "workflow.action_needed": workflowActionNeeded,
  "auth.magic_link": authMagicLink,
  "auth.invite": authInvite,
  "verification.approved": verificationApproved,
  "verification.rejected": verificationRejected,
  "matter.deadline_reminder": matterDeadlineReminder,
};
