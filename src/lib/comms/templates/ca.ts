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

export const CA_TEMPLATES: Record<string, TemplateRenderer> = {
  "auth.magic_link": authMagicLink,
};
