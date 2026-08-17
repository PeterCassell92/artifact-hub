import { getEnv } from "../../../env";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailCta {
  label: string;
  url: string;
}

export interface EmailLayoutHtmlInput {
  heading: string;
  bodyHtml: string;
  cta?: EmailCta;
}

/** Shared branded HTML shell (logo header, card, footer) reused by every outgoing email — no
 * templating dependency, just one composer function so the 4 email types render consistently. */
export function renderEmailHtml({ heading, bodyHtml, cta }: EmailLayoutHtmlInput): string {
  const appOrigin = getEnv().APP_ORIGIN;
  const ctaHtml = cta
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#2E7DA3;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">${escapeHtml(cta.label)}</a></p>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid #e4e7eb;">
                <img src="${appOrigin}/email-logo.png" width="36" height="36" alt="Artifact Hub" style="vertical-align:middle;border-radius:50%;" />
                <span style="vertical-align:middle;margin-left:10px;font-size:16px;font-weight:600;color:#1f2933;">Artifact Hub</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(heading)}</h1>
                ${bodyHtml}
                ${ctaHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f8f9fa;font-size:12px;color:#7b8794;">
                <a href="${appOrigin}" style="color:#7b8794;">${appOrigin.replace(/^https?:\/\//, "")}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export interface EmailLayoutTextInput {
  heading: string;
  bodyLines: string[];
  cta?: EmailCta;
}

/** Plain-text sibling of `renderEmailHtml`, mirroring its structure (`mailer.ts`'s `SendMailInput`
 * always sends a text/html pair). */
export function renderEmailText({ heading, bodyLines, cta }: EmailLayoutTextInput): string {
  const appOrigin = getEnv().APP_ORIGIN;
  const lines = [heading, "", ...bodyLines];
  if (cta) lines.push("", `${cta.label}: ${cta.url}`);
  lines.push("", appOrigin);
  return lines.join("\n");
}
