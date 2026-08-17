import { escapeHtml, renderEmailHtml, renderEmailText } from "./layout";
import type { BuiltEmail } from "./invitationEmail";

export interface BuildAccessRevokedEmailInput {
  recipientName: string | null;
  artifactTitle: string;
}

export function buildAccessRevokedEmail({
  recipientName,
  artifactTitle,
}: BuildAccessRevokedEmailInput): BuiltEmail {
  const heading = "Access revoked";
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi,";
  const message = `Your access to "${artifactTitle}" has been revoked by its owner. You can no longer view or download it.`;

  const bodyHtml = `
    <p style="margin:0 0 16px;line-height:1.5;">${greeting}</p>
    <p style="margin:0;line-height:1.5;">Your access to <strong>${escapeHtml(artifactTitle)}</strong> has been revoked by its owner. You can no longer view or download it.</p>
  `;

  return {
    subject: `Your access to "${artifactTitle}" has been revoked`,
    html: renderEmailHtml({ heading, bodyHtml }),
    text: renderEmailText({ heading, bodyLines: [greeting, message] }),
  };
}
