// Shared template-rendering helpers. Every template module (./ca.ts, and
// whatever a future vertical adds) should build its HTML through
// escapeHtml() for any user-supplied or otherwise dynamic string — see
// ../../../../comms/README.md's Guardrails: "Templates render user-supplied
// data as escaped text, never raw HTML interpolation." A confirmation URL
// built server-side from token_hash/redirect_to is not itself
// attacker-controlled free text, but anything that ever comes from a name,
// note, or email-address field must go through this before landing in HTML.

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Minimal shared shell — deliberately plain-table-based inline-CSS HTML,
// the one layout style that survives every major email client's CSS
// stripping. Not a full design-system component (../../../design-system/
// doesn't have an email surface yet); revisit if/when it does.
export function emailShell(opts: { previewText: string; bodyHtml: string }): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none;font-size:1px;color:#f8fafc;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
      ${escapeHtml(opts.previewText)}
    </span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
            ${opts.bodyHtml}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
