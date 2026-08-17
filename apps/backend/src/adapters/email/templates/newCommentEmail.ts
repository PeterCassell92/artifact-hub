import { escapeHtml, renderEmailHtml, renderEmailText } from "./layout";
import type { BuiltEmail } from "./invitationEmail";

export interface BuildNewCommentEmailInput {
  recipientName: string | null;
  commenterName: string;
  artifactTitle: string;
  artifactId: string;
  appOrigin: string;
}

export function buildNewCommentEmail({
  recipientName,
  commenterName,
  artifactTitle,
  artifactId,
  appOrigin,
}: BuildNewCommentEmailInput): BuiltEmail {
  const heading = "New comment";
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi,";
  const url = `${appOrigin}/artifacts/${artifactId}`;

  const bodyHtml = `
    <p style="margin:0 0 16px;line-height:1.5;">${greeting}</p>
    <p style="margin:0;line-height:1.5;"><strong>${escapeHtml(commenterName)}</strong> commented on <strong>${escapeHtml(artifactTitle)}</strong>.</p>
  `;

  return {
    subject: `New comment on "${artifactTitle}"`,
    html: renderEmailHtml({ heading, bodyHtml, cta: { label: "View comment", url } }),
    text: renderEmailText({
      heading,
      bodyLines: [greeting, `${commenterName} commented on "${artifactTitle}".`],
      cta: { label: "View comment", url },
    }),
  };
}
