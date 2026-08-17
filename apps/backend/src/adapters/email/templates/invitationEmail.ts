import { renderEmailHtml, renderEmailText } from "./layout";

export interface BuildInvitationEmailInput {
  acceptUrl: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildInvitationEmail({ acceptUrl }: BuildInvitationEmailInput): BuiltEmail {
  const heading = "You've been invited to Artifact Hub";
  const bodyHtml = `<p style="margin:0;line-height:1.5;">Accept your invitation to get started.</p>`;
  const cta = { label: "Accept your invitation", url: acceptUrl };

  return {
    subject: heading,
    html: renderEmailHtml({ heading, bodyHtml, cta }),
    text: renderEmailText({ heading, bodyLines: ["Accept your invitation to get started."], cta }),
  };
}
