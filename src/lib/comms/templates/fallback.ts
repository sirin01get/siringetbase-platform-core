// Generic, role-agnostic fallback templates — used when a (vertical, role,
// triggerEvent) has no dedicated entry yet. Per ../../../../comms/README.md's
// Rollout Plan step 2: "individual/small-business templates stubbed ahead
// of those onboarding flows existing." This is that stub, kept generic
// rather than duplicated per not-yet-built role so a new role never hits a
// hard "no template found" error just because nobody has written its copy
// yet — see ../templates/registry.ts's lookup fallback order.

import type { RenderedEmail, TemplateRenderer } from "../types";
import { emailShell, escapeHtml } from "./shared";

function authMagicLink(data: Record<string, unknown>): RenderedEmail {
  const confirmationUrl = String(data.confirmationUrl ?? "");
  const backupCode = data.token ? String(data.token) : null;

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#334155;">
          Siringet
        </p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">
          Your sign-in link
        </h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
          Use the button below to sign in.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="border-radius:10px;background:#0f172a;">
              <a href="${escapeHtml(confirmationUrl)}"
                 style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Sign in
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
          safely ignore this email.
        </p>
      </td>
    </tr>`;

  return {
    subject: "Your sign-in link",
    html: emailShell({ previewText: "Your sign-in link", bodyHtml }),
    text: `Sign in: ${confirmationUrl}${backupCode ? `\n\nOr use this one-time code: ${backupCode}` : ""}\n\nThis link expires shortly and can only be used once. If you didn't request it, you can safely ignore this email.`,
  };
}

// Generic marketer-invite copy for a referee_intended_role other than "ca"
// (see ../templates/ca.ts's referralMarketerInvite for the branded CA Focus
// version, registered under role "ca"). No such invite exists yet — only
// CA onboarding is built (app/api/admin/referrals/invite/route.ts's
// header comment) — but the invite route defaults intended_role from
// request input, not a hardcoded constant, so this keeps a future
// non-CA invite from hitting a hard "no template found" error.
function referralMarketerInvite(data: Record<string, unknown>): RenderedEmail {
  const inviteLink = String(data.inviteLink ?? "");

  const bodyHtml = `
    <tr>
      <td style="padding:32px 32px 24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#334155;">
          Siringet
        </p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">
          You've been invited
        </h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
          Someone thinks you'd be a great fit. Use the button below to accept your invite.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="border-radius:10px;background:#0f172a;">
              <a href="${escapeHtml(inviteLink)}"
                 style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Accept invite
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
          If you weren't expecting this, you can safely ignore this email.
        </p>
      </td>
    </tr>`;

  return {
    subject: "You've been invited",
    html: emailShell({ previewText: "You've been invited", bodyHtml }),
    text: `You've been invited.\n\nAccept your invite: ${inviteLink}\n\nIf you weren't expecting this, you can safely ignore this email.`,
  };
}

export const FALLBACK_TEMPLATES: Record<string, TemplateRenderer> = {
  "auth.magic_link": authMagicLink,
  "referral.marketer_invite": referralMarketerInvite,
};
