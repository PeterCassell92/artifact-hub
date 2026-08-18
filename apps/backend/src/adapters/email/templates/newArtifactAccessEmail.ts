import type { ArtifactKind } from "contracts";
import { escapeHtml, renderEmailHtml, renderEmailText } from "./layout";
import type { BuiltEmail } from "./invitationEmail";
import { artifactKindIcon, kindLabel } from "./icons";
import { filetypeLabel, formatBytes } from "./format";

export interface BuildNewArtifactAccessEmailInput {
  recipientName: string | null;
  sharingUser: string;
  artifact: {
    id: string;
    title: string;
    kind: ArtifactKind;
    contentType: string;
    fileName: string;
    sizeBytes: number;
  };
  appOrigin: string;
}

export function buildNewArtifactAccessEmail({
  recipientName,
  sharingUser,
  artifact,
  appOrigin,
}: BuildNewArtifactAccessEmailInput): BuiltEmail {
  const heading = "An artifact has been shared with you";
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi,";
  const icon = artifactKindIcon(artifact.kind);
  const filetype = filetypeLabel(artifact);
  const size = formatBytes(artifact.sizeBytes);
  const url = `${appOrigin}/artifacts/${artifact.id}`;
  const metaLine = `${kindLabel(artifact.kind)} · ${filetype} · ${size}`;

  const bodyHtml = `
    <p style="margin:0 0 16px;line-height:1.5;">${greeting}</p>
    <p style="margin:0 0 16px;line-height:1.5;">You now have access to a new artifact:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8f9fa;border-radius:8px;">
      <tr>
        <td style="padding:16px;">
          <span style="font-size:28px;vertical-align:middle;">${icon}</span>
          <span style="vertical-align:middle;margin-left:10px;font-size:16px;font-weight:600;">${escapeHtml(artifact.title)}</span>
          <div style="margin-top:8px;font-size:13px;color:#52606d;">${escapeHtml(metaLine)}</div>
        </td>
      </tr>
    </table>
  `;

  return {
    subject: `${sharingUser} shared an Artifact with you`,
    html: renderEmailHtml({ heading, bodyHtml, cta: { label: "View artifact", url } }),
    text: renderEmailText({
      heading,
      bodyLines: [greeting, "You now have access to a new artifact:", `${artifact.title} — ${metaLine}`],
      cta: { label: "View artifact", url },
    }),
  };
}
