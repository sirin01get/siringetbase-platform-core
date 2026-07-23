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
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
          Someone thinks you'd be a great fit for CA Focus — the practice workspace for pricing
          your services, taking on clients, and running verified engagements. Get started below.
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
    text: `You've been invited to CA Focus.\n\nAccept your invite: ${inviteLink}\n\nIf you weren't expecting this, you can safely ignore this email.`,
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
          You can update your details and resubmit whenever you're ready.
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
    text: `Update on your CA Focus verification.\n\nWe weren't able to verify your profile this time.\n\nReason: ${rejectionReason}\n\nYou can update your details and resubmit whenever you're ready.${signInUrl ? `\n\n${signInUrl}` : ""}`,
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
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
          Someone you know worked with <strong style="color:#0f172a;">${escapeHtml(caFirmName)}</strong>
          on CA Focus and wanted you to know about them — for tax filing, GST, audits, and other
          engagements handled through verified, priced-up-front CA profiles.
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
    text: `Someone you know worked with ${caFirmName} on CA Focus and wanted you to know about them.${siteUrl ? `\n\n${siteUrl}` : ""}\n\nIf this isn't relevant to you, no action is needed.`,
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
    text: `${serviceDisplayName} payment due: ₹${amount}.\n\nYou're on manual monthly billing, so this isn't charged automatically.${payUrl ? `\n\nPay now: ${payUrl}` : ""}\n\nPrefer automatic collection? Switch to auto-renew from your subscription settings.`,
  };
}

export const CA_TEMPLATES: Record<string, TemplateRenderer> = {
  "auth.magic_link": authMagicLink,
  "referral.marketer_invite": referralMarketerInvite,
  "verification.approved": verificationApproved,
  "verification.rejected": verificationRejected,
  "subscription.payment_due": subscriptionPaymentDue,
};

// Same copy, addressed to a non-CA recipient — see registry.ts's "prospect"
// role bucket comment.
export const PROSPECT_TEMPLATES: Record<string, TemplateRenderer> = {
  "referral.client_endorsement": referralClientEndorsement,
};
