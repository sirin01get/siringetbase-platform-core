// Platform-internal templates — rendered for the support team, not an end
// user. Deliberately plain (no brand chrome, no CA Focus rose/fuchsia
// styling) since the audience is Siringet's own support staff regardless
// of which vertical the report came from. See
// ../../../../support-escalation/README.md's "Where This Lives" section.
//
// Not keyed into REGISTRY in ./registry.ts the way CA_TEMPLATES is — these
// are triggerEvents no vertical/role ever supplies its own copy for, so
// they're looked up via a separate INTERNAL_TEMPLATES map, checked before
// the vertical/role registry so a vertical can never accidentally shadow
// (or be required to supply) an internal template.

import type { RenderedEmail, TemplateRenderer } from "../types";
import { emailShell, escapeHtml } from "./shared";

function supportErrorReportFiled(data: Record<string, unknown>): RenderedEmail {
  const vertical = String(data.vertical ?? "unknown");
  const role = String(data.role ?? "unknown");
  const errorMessage = String(data.errorMessage ?? "(no message captured)");
  const reportId = String(data.reportId ?? "");
  const reporterLabel = String(data.reporterLabel ?? "anonymous visitor");
  const hasScreenshot = Boolean(data.hasScreenshot);
  const breadcrumbCount = typeof data.breadcrumbCount === "number" ? data.breadcrumbCount : 0;

  const bodyHtml = `
    <tr>
      <td style="padding:28px 28px 20px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;">
          Support Escalation — New Report
        </p>
        <h1 style="margin:0 0 18px;font-size:18px;line-height:1.4;color:#0f172a;">
          ${escapeHtml(vertical)} / ${escapeHtml(role)}
        </h1>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;color:#334155;">
          <tr><td style="padding:4px 0;color:#64748b;width:130px;">Reporter</td><td style="padding:4px 0;">${escapeHtml(reporterLabel)}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b;">Error message</td><td style="padding:4px 0;">${escapeHtml(errorMessage)}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b;">Screenshot</td><td style="padding:4px 0;">${hasScreenshot ? "Attached (see report record)" : "Not provided"}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b;">Activity trail</td><td style="padding:4px 0;">${breadcrumbCount} step${breadcrumbCount === 1 ? "" : "s"} captured</td></tr>
          ${reportId ? `<tr><td style="padding:4px 0;color:#64748b;">Report ID</td><td style="padding:4px 0;">${escapeHtml(reportId)}</td></tr>` : ""}
        </table>
        <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;">
          Full context, breadcrumbs, and the screenshot (if any) are on the
          support_error_reports row above. No admin triage queue view exists
          yet — see support-escalation/README.md's Admin Triage section.
        </p>
      </td>
    </tr>`;

  return {
    subject: `[Support] ${vertical}/${role}: ${errorMessage.slice(0, 80)}`,
    html: emailShell({ previewText: `New support report from ${vertical}/${role}`, bodyHtml }),
    text: `New support escalation report\n\nVertical/role: ${vertical}/${role}\nReporter: ${reporterLabel}\nError: ${errorMessage}\nScreenshot: ${hasScreenshot ? "attached" : "not provided"}\nActivity trail: ${breadcrumbCount} step(s)\n${reportId ? `Report ID: ${reportId}\n` : ""}`,
  };
}

// Sibling of supportErrorReportFiled above — same internal/plain posture,
// backing the "Request a feature" floater's ingestion route
// (cafocus/app/app/api/feature-requests/route.ts). "description" replaces
// "errorMessage" as the primary field; there's no dedup/occurrence count
// here (see 0035_chat_and_feature_requests.sql's header comment for why a
// repeated ask isn't merged the way a repeated error is).
function supportFeatureRequestFiled(data: Record<string, unknown>): RenderedEmail {
  const vertical = String(data.vertical ?? "unknown");
  const role = String(data.role ?? "unknown");
  const description = String(data.description ?? "(no description captured)");
  const requestId = String(data.requestId ?? "");
  const requesterLabel = String(data.requesterLabel ?? "anonymous visitor");
  const hasScreenshot = Boolean(data.hasScreenshot);
  const breadcrumbCount = typeof data.breadcrumbCount === "number" ? data.breadcrumbCount : 0;

  const bodyHtml = `
    <tr>
      <td style="padding:28px 28px 20px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;">
          Feature Request
        </p>
        <h1 style="margin:0 0 18px;font-size:18px;line-height:1.4;color:#0f172a;">
          ${escapeHtml(vertical)} / ${escapeHtml(role)}
        </h1>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;color:#334155;">
          <tr><td style="padding:4px 0;color:#64748b;width:130px;">Requested by</td><td style="padding:4px 0;">${escapeHtml(requesterLabel)}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b;">Description</td><td style="padding:4px 0;">${escapeHtml(description)}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b;">Screenshot</td><td style="padding:4px 0;">${hasScreenshot ? "Attached (see request record)" : "Not provided"}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b;">Activity trail</td><td style="padding:4px 0;">${breadcrumbCount} step${breadcrumbCount === 1 ? "" : "s"} captured</td></tr>
          ${requestId ? `<tr><td style="padding:4px 0;color:#64748b;">Request ID</td><td style="padding:4px 0;">${escapeHtml(requestId)}</td></tr>` : ""}
        </table>
        <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;">
          Full context, breadcrumbs, and the screenshot (if any) are on the
          feature_requests row above. Triage at /admin/feature-requests.
        </p>
      </td>
    </tr>`;

  return {
    subject: `[Feature request] ${vertical}/${role}: ${description.slice(0, 80)}`,
    html: emailShell({ previewText: `New feature request from ${vertical}/${role}`, bodyHtml }),
    text: `New feature request\n\nVertical/role: ${vertical}/${role}\nRequested by: ${requesterLabel}\nDescription: ${description}\nScreenshot: ${hasScreenshot ? "attached" : "not provided"}\nActivity trail: ${breadcrumbCount} step(s)\n${requestId ? `Request ID: ${requestId}\n` : ""}`,
  };
}

export const INTERNAL_TEMPLATES: Record<string, TemplateRenderer> = {
  "support.error_report_filed": supportErrorReportFiled,
  "support.feature_request_filed": supportFeatureRequestFiled,
};
