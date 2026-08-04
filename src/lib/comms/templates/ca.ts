// CA Focus's own email copy — comms owns the pipeline/registry, CA Focus
// (the vertical) owns what these say, per ../../../../comms/README.md's
// "The Boundary Rule". Brand colors match cafocus/app/tailwind.config.ts's
// `brand` scale (brand-700 #d1006f) so the email doesn't look like a
// different product from the sign-in page it follows.
//
// Registered into ../templates/registry.ts under vertical "cafocus",
// role "ca".

import type { RenderedEmail, TemplateRenderer } from "../types";
import { emailShell, escapeHtml } from "./shared";

const BRAND = "#d1006f";

function authMagicLink(data: Record<string, unknown>): RenderedEmail {
  const confirmationUrl = String(data.confirmationUrl ?? "");
  const backupCode = data.token ? String(data.token) : null;

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND};">
          CA Focus
        </p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">
          Your sign-in link
        </h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
          Use the button below to sign in to CA Focus — your practice workspace for pricing your
          services, taking on clients, and running verified engagements.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="border-radius:10px;background:${BRAND};">
              <a href="${escapeHtml(confirmationUrl)}"
                 style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Sign in to CA Focus
              </a>
            </td>
          </tr>
        </table>
        ${
          backupCode
            ? `<p style="margin:24px 0 0;font-size:13px;color:#64748b;">
                 Button not working? Use this one-time code instead: <strong style="color:#0f172a;letter-spacing:0.06em;">${escapeHtml(backupCode)}</strong>
               </p>`
            : ""
        }
        <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
          This link expires shortly and can only be used once. If you didn't request it, you can
          safely ignore this email — no account changes were made.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 32px;background:#fdf2f8;border-top:1px solid #fce7f3;">
        <p style="margin:0;font-size:12px;color:#9d174d;">
          Precision work, valued precisely — CA Focus, part of the Siringet platform.
        </p>
      </td>
    </tr>`;

  return {
    subject: "Your CA Focus sign-in link",
    html: emailShell({ previewText: "Sign in to CA Focus", bodyHtml }),
    text: `Sign in to CA Focus: ${confirmationUrl}${backupCode ? `\n\nOr use this one-time code: ${backupCode}` : ""}\n\nThis link expires shortly and can only be used once. If you didn't request it, you can safely ignore this email.`,
  };
}

// Comms Rollout Plan step 3 (../../../../comms/README.md) — referral
// invites and verification decisions, called from cafocus/app's own
// backend via sendNotification()/POST /api/comms/notify rather than the
// Supabase Send Email Hook (no auth event triggers these, see
// send-notification.ts's header comment on the "two entry points").

function referralMarketerInvite(data: Record<string, unknown>): RenderedEmail {
  const inviteLink = String(data.inviteLink ?? "");

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND};">
          Siringet Referred
        </p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">
          You've been invited to CA Focus
        </h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
          Someone thinks you'd be a great fit for CA Focus — the practice workspace where
          chartered accountants price their services, take on pre-scoped clients, and run
          verified engagements, replacing the spreadsheet-and-email-thread routine.
        </p>
        <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#64748b;">
          Free to list — there's no cost to join or set up your profile.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="border-radius:10px;background:${BRAND};">
              <a href="${escapeHtml(inviteLink)}"
                 style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Accept invite
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:12px 0 0;font-size:13px;color:#94a3b8;">
          Takes about a minute — sign in with just your email, no password.
        </p>
        <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
          Accepting this invite carries the Siringet Referred credential into your profile once
          you're verified. If you weren't expecting this, you can safely ignore this email.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 32px;background:#fdf2f8;border-top:1px solid #fce7f3;">
        <p style="margin:0;font-size:12px;color:#9d174d;">
          Precision work, valued precisely — CA Focus, part of the Siringet platform.
        </p>
      </td>
    </tr>`;

  return {
    subject: "You've been invited to CA Focus",
    html: emailShell({ previewText: "You've been invited to CA Focus", bodyHtml }),
    text: `You've been invited to CA Focus — the practice workspace for pricing your services, taking on clients, and running verified engagements. Free to list, no cost to join.\n\nAccept your invite: ${inviteLink}\n\nIf you weren't expecting this, you can safely ignore this email.`,
  };
}

// A CA inviting an *existing* client they already serve onto the platform
// for a specific, already-agreed engagement — distinct from
// referralMarketerInvite() above, which is the generic "someone thinks
// you'd be a great fit" invite reused by the self-service invite flow and
// the admin invite tool. Registered separately (as "referral.ca_client_invite",
// under the "individual"/"smb_owner" role buckets — see ../templates/registry.ts)
// so branding this one doesn't change copy on those other two flows, which
// have no service/fee context to reference. Deliberately no money mentioned
// here (no fee amount, no "escrow" framing) — the owner's ask was to keep
// this invite about the working relationship, not a transaction; the actual
// fee is disclosed once the client is inside the product, on the
// engagement itself. Sent from cafocus/app's
// app/api/ca/invite-client/route.ts.
//
// Confidence/ease pass (owner's ask, after the first version shipped): a
// client who's never heard of CA Focus has no way to tell this apart from a
// phishing-style invite, and no idea what clicking through actually
// commits them to. Four additions address that, in order of appearance:
// (1) "ICAI-verified CA" as a trust anchor — true for every sender of this
// email, since getActiveCaRoleProfile() (the route's own auth gate) only
// resolves a role_profiles.status === "active" CA, i.e. already verified;
// (2) a one-line explanation of what CA Focus even is, since the recipient
// may only trust their CA, not yet the platform; (3) an explicit
// nothing-to-pay-or-sign-yet line, since "release your payment" alone can
// read as "something is about to be charged"; (4) a what-happens-next line
// before the click, so the sign-in step isn't a surprise. The optional note
// box now sits *after* the button rather than between the body and the
// CTA, so it doesn't add visual distance to the one action that matters.
function referralCaClientInvite(data: Record<string, unknown>): RenderedEmail {
  const inviteLink = String(data.inviteLink ?? "");
  const firmName = data.firmName ? String(data.firmName) : "A CA on Siringet";
  const serviceTypeDisplayName = data.serviceTypeDisplayName ? String(data.serviceTypeDisplayName) : "your filing";
  const note = data.note ? String(data.note) : null;

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND};">
          CA Focus
        </p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">
          You're invited to work with ${escapeHtml(firmName)}
        </h1>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">
          <strong style="color:#0f172a;">${escapeHtml(firmName)}</strong> is an ICAI-verified CA on
          Siringet and has invited you to handle your
          <strong style="color:#0f172a;">${escapeHtml(serviceTypeDisplayName)}</strong> here — the
          workspace where they run client work instead of email threads and spreadsheets.
        </p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
          Once you accept, your documents, deadlines, and this engagement all live in one place —
          no re-explaining your situation over email. Release your payment once work is delivered.
        </p>
        <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#64748b;">
          Nothing to pay or sign right now — this just gets you both on the same page.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="border-radius:10px;background:${BRAND};">
              <a href="${escapeHtml(inviteLink)}"
                 style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Accept invite &amp; get started
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:12px 0 0;font-size:13px;color:#94a3b8;">
          Takes about 30 seconds — no password needed, just your email to sign in.
        </p>
        <p style="margin:8px 0 0;font-size:13px;color:#94a3b8;">
          Have a question before you accept? Just reply to this email — it goes straight to
          ${escapeHtml(firmName)}.
        </p>
        ${
          note
            ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border-radius:10px;margin:20px 0 0;">
                 <tr>
                   <td style="padding:14px 16px;font-size:14px;color:#334155;">
                     A note from ${escapeHtml(firmName)}: &ldquo;${escapeHtml(note)}&rdquo;
                   </td>
                 </tr>
               </table>`
            : ""
        }
        <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
          If you weren't expecting this, you can safely ignore this email.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 32px;background:#fdf2f8;border-top:1px solid #fce7f3;">
        <p style="margin:0;font-size:12px;color:#9d174d;">
          Precision work, valued precisely — CA Focus, part of the Siringet platform.
        </p>
      </td>
    </tr>`;

  return {
    subject: `${firmName} invited you to file together on CA Focus`,
    html: emailShell({ previewText: `${firmName} invited you to CA Focus`, bodyHtml }),
    text: `${firmName} is an ICAI-verified CA on Siringet and invited you to CA Focus for ${serviceTypeDisplayName}. Nothing to pay or sign right now.${
      note ? `\n\nA note from ${firmName}: "${note}"` : ""
    }\n\nAccept your invite (takes about 30 seconds, no password needed): ${inviteLink}\n\nHave a question before you accept? Just reply to this email — it goes straight to ${firmName}.\n\nIf you weren't expecting this, you can safely ignore this email.`,
  };
}

function verificationApproved(data: Record<string, unknown>): RenderedEmail {
  const signInUrl = String(data.signInUrl ?? "");
  const firmName = data.firmName ? String(data.firmName) : null;

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND};">
          CA Focus
        </p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">
          You're verified${firmName ? `, ${escapeHtml(firmName)}` : ""}
        </h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
          Your CA Focus profile has been reviewed and verified. You're now eligible to receive
          marketplace leads and can start setting up your service catalog.
        </p>
        ${
          signInUrl
            ? `<table role="presentation" cellpadding="0" cellspacing="0">
                 <tr>
                   <td style="border-radius:10px;background:${BRAND};">
                     <a href="${escapeHtml(signInUrl)}"
                        style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                       Go to CA Focus
                     </a>
                   </td>
                 </tr>
               </table>`
            : ""
        }
      </td>
    </tr>
    <tr>
      <td style="padding:20px 32px;background:#fdf2f8;border-top:1px solid #fce7f3;">
        <p style="margin:0;font-size:12px;color:#9d174d;">
          Precision work, valued precisely — CA Focus, part of the Siringet platform.
        </p>
      </td>
    </tr>`;

  return {
    subject: "You're verified on CA Focus",
    html: emailShell({ previewText: "Your CA Focus profile is verified", bodyHtml }),
    text: `You're verified on CA Focus.\n\nYour profile has been reviewed and verified — you're now eligible to receive marketplace leads.${signInUrl ? `\n\nSign in: ${signInUrl}` : ""}`,
  };
}

function verificationRejected(data: Record<string, unknown>): RenderedEmail {
  const signInUrl = String(data.signInUrl ?? "");
  const rejectionReason = data.rejectionReason ? String(data.rejectionReason) : "Not specified";

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND};">
          CA Focus
        </p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">
          Update on your verification
        </h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
          We weren't able to verify your CA Focus profile this time.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border-radius:10px;margin:0 0 24px;">
          <tr>
            <td style="padding:14px 16px;font-size:14px;color:#334155;">
              ${escapeHtml(rejectionReason)}
            </td>
          </tr>
        </table>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
          This isn't final — you can update your details and resubmit whenever you're ready, and
          most resubmissions are reviewed quickly.
        </p>
        ${
          signInUrl
            ? `<table role="presentation" cellpadding="0" cellspacing="0">
                 <tr>
                   <td style="border-radius:10px;background:${BRAND};">
                     <a href="${escapeHtml(signInUrl)}"
                        style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                       Resubmit on CA Focus
                     </a>
                   </td>
                 </tr>
               </table>`
            : ""
        }
      </td>
    </tr>
    <tr>
      <td style="padding:20px 32px;background:#fdf2f8;border-top:1px solid #fce7f3;">
        <p style="margin:0;font-size:12px;color:#9d174d;">
          Precision work, valued precisely — CA Focus, part of the Siringet platform.
        </p>
      </td>
    </tr>`;

  return {
    subject: "Update on your CA Focus verification",
    html: emailShell({ previewText: "Update on your CA Focus verification", bodyHtml }),
    text: `Update on your CA Focus verification.\n\nWe weren't able to verify your profile this time.\n\nReason: ${rejectionReason}\n\nThis isn't final — you can update your details and resubmit whenever you're ready, and most resubmissions are reviewed quickly.${signInUrl ? `\n\n${signInUrl}` : ""}`,
  };
}

// Client-endorsement broadcast recipients aren't CAs — they're the people a
// client is telling about a CA they'd recommend. Registered under a
// synthetic "prospect" role bucket in ../templates/registry.ts (not a real
// siringetbase.role_profiles.role value) since there's no individual/
// small-business onboarding flow yet for this to point at
// (cafocus/README.md's phase plan) — this is an FYI/intro email, not a
// specific-page CTA.
function referralClientEndorsement(data: Record<string, unknown>): RenderedEmail {
  const caFirmName = data.caFirmName ? String(data.caFirmName) : "a Chartered Accountant";
  const siteUrl = String(data.siteUrl ?? "");

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND};">
          CA Focus
        </p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">
          A recommendation for you
        </h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
          Someone you know worked with <strong style="color:#0f172a;">${escapeHtml(caFirmName)}</strong>,
          an ICAI-verified CA, on CA Focus and wanted you to know about them — for tax filing,
          GST, audits, and other engagements handled through verified, priced-up-front CA profiles.
        </p>
        <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#64748b;">
          No obligation — this is just an introduction, nothing to sign or pay.
        </p>
        ${
          siteUrl
            ? `<table role="presentation" cellpadding="0" cellspacing="0">
                 <tr>
                   <td style="border-radius:10px;background:${BRAND};">
                     <a href="${escapeHtml(siteUrl)}"
                        style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                       Take a look
                     </a>
                   </td>
                 </tr>
               </table>`
            : ""
        }
        <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
          If this isn't relevant to you, no action is needed — you can safely ignore this email.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 32px;background:#fdf2f8;border-top:1px solid #fce7f3;">
        <p style="margin:0;font-size:12px;color:#9d174d;">
          Precision work, valued precisely — CA Focus, part of the Siringet platform.
        </p>
      </td>
    </tr>`;

  return {
    subject: `A recommendation for ${caFirmName}`,
    html: emailShell({ previewText: `Someone recommended ${caFirmName} on CA Focus`, bodyHtml }),
    text: `Someone you know worked with ${caFirmName}, an ICAI-verified CA, on CA Focus and wanted you to know about them. No obligation — just an introduction.${siteUrl ? `\n\n${siteUrl}` : ""}\n\nIf this isn't relevant to you, no action is needed.`,
  };
}

// Recurring module-subscription billing, "manual_monthly" payment mode —
// there's no mandate to auto-charge, so each period's due amount needs a
// nudge to the CA rather than silently retrying forever. Sent by
// cafocus/app's src/lib/subscriptions/subscription-billing.ts (the internal
// billing-cycle route platform-core's daily cron triggers) once per pending
// invoice.
function subscriptionPaymentDue(data: Record<string, unknown>): RenderedEmail {
  const serviceDisplayName = String(data.serviceDisplayName ?? "your subscription");
  const amount = String(data.amount ?? "");
  const payUrl = String(data.payUrl ?? "");

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND};">
          CA Focus
        </p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">
          ${escapeHtml(serviceDisplayName)} payment due
        </h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
          Your monthly payment of <strong style="color:#0f172a;">₹${escapeHtml(amount)}</strong> for
          ${escapeHtml(serviceDisplayName)} is due. You're on manual monthly billing, so this doesn't
          get charged automatically — pay below to keep it active.
        </p>
        ${
          payUrl
            ? `<table role="presentation" cellpadding="0" cellspacing="0">
                 <tr>
                   <td style="border-radius:10px;background:${BRAND};">
                     <a href="${escapeHtml(payUrl)}"
                        style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                       Pay now
                     </a>
                   </td>
                 </tr>
               </table>`
            : ""
        }
        <p style="margin:12px 0 0;font-size:13px;color:#94a3b8;">
          Takes you to a secure page on your own CA Focus dashboard — no card details are entered
          in this email.
        </p>
        <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
          Prefer not to do this every month? Switch to auto-renew from your subscription settings and
          this gets collected automatically going forward.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 32px;background:#fdf2f8;border-top:1px solid #fce7f3;">
        <p style="margin:0;font-size:12px;color:#9d174d;">
          Precision work, valued precisely — CA Focus, part of the Siringet platform.
        </p>
      </td>
    </tr>`;

  return {
    subject: `${serviceDisplayName} payment due — ₹${amount}`,
    html: emailShell({ previewText: `${serviceDisplayName} payment of ₹${amount} is due`, bodyHtml }),
    text: `${serviceDisplayName} payment due: ₹${amount}.\n\nYou're on manual monthly billing, so this isn't charged automatically.${payUrl ? `\n\nPay now (takes you to your own CA Focus dashboard, no card details in this email): ${payUrl}` : ""}\n\nPrefer automatic collection? Switch to auto-renew from your subscription settings.`,
  };
}

// Marketplace notification (individual/business post a requirement) —
// admin-togglable at cafocus/app's /admin/notification-settings (see
// src/lib/marketplace/notifications.ts's header comment there for the full
// event list). Sent to every CA whose active service catalog matches the
// requirement's service type — see
// src/lib/marketplace/service.ts's notifyMatchingCasOfRequirement().
function marketplaceRequirementMatched(data: Record<string, unknown>): RenderedEmail {
  const requirementTitle = String(data.requirementTitle ?? "A new requirement");
  const serviceTypeDisplayName = data.serviceTypeDisplayName ? String(data.serviceTypeDisplayName) : null;
  const clientDisplayName = data.clientDisplayName ? String(data.clientDisplayName) : null;
  const practiceUrl = String(data.practiceUrl ?? "");

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND};">
          CA Focus
        </p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">
          A new requirement matches your practice
        </h1>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border-radius:10px;margin:0 0 24px;">
          <tr>
            <td style="padding:14px 16px;font-size:14px;color:#334155;">
              <strong style="color:#0f172a;">${escapeHtml(requirementTitle)}</strong>
              ${serviceTypeDisplayName ? `<br/>${escapeHtml(serviceTypeDisplayName)}` : ""}
              ${clientDisplayName ? `<br/>Posted by ${escapeHtml(clientDisplayName)}` : ""}
            </td>
          </tr>
        </table>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
          Send a proposal with your fee if you'd like to take this on.
        </p>
        ${
          practiceUrl
            ? `<table role="presentation" cellpadding="0" cellspacing="0">
                 <tr>
                   <td style="border-radius:10px;background:${BRAND};">
                     <a href="${escapeHtml(practiceUrl)}"
                        style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                       View requirement
                     </a>
                   </td>
                 </tr>
               </table>`
            : ""
        }
      </td>
    </tr>
    <tr>
      <td style="padding:20px 32px;background:#fdf2f8;border-top:1px solid #fce7f3;">
        <p style="margin:0;font-size:12px;color:#9d174d;">
          Precision work, valued precisely — CA Focus, part of the Siringet platform.
        </p>
      </td>
    </tr>`;

  return {
    subject: `New requirement: ${requirementTitle}`,
    html: emailShell({ previewText: `A new requirement matches your practice: ${requirementTitle}`, bodyHtml }),
    text: `A new requirement matches your practice.\n\n${requirementTitle}${serviceTypeDisplayName ? ` (${serviceTypeDisplayName})` : ""}${clientDisplayName ? `\nPosted by ${clientDisplayName}` : ""}\n\nSend a proposal with your fee if you'd like to take this on.${practiceUrl ? `\n\n${practiceUrl}` : ""}`,
  };
}

export const CA_TEMPLATES: Record<string, TemplateRenderer> = {
  "auth.magic_link": authMagicLink,
  "referral.marketer_invite": referralMarketerInvite,
  "verification.approved": verificationApproved,
  "verification.rejected": verificationRejected,
  "subscription.payment_due": subscriptionPaymentDue,
  "marketplace.requirement_matched": marketplaceRequirementMatched,
};

// Same copy, addressed to a non-CA recipient — see registry.ts's "prospect"
// role bucket comment.
export const PROSPECT_TEMPLATES: Record<string, TemplateRenderer> = {
  "referral.client_endorsement": referralClientEndorsement,
};

// Individual/smb_owner-facing templates — deliberately just this one entry,
// not a parallel full copy of CA_TEMPLATES. See registry.ts's comment on
// why these two roles otherwise fall through to FALLBACK_TEMPLATES.
export const CLIENT_TEMPLATES: Record<string, TemplateRenderer> = {
  "referral.ca_client_invite": referralCaClientInvite,
};
