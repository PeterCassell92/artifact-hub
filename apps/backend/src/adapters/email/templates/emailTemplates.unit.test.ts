import { buildInvitationEmail } from "./invitationEmail";
import { buildNewArtifactAccessEmail } from "./newArtifactAccessEmail";
import { buildAccessRevokedEmail } from "./accessRevokedEmail";
import { buildNewCommentEmail } from "./newCommentEmail";

describe("buildInvitationEmail", () => {
  it("includes the accept URL as the CTA in both html and text", () => {
    const email = buildInvitationEmail({ acceptUrl: "https://artifact-hub.test/accept-invite?token=abc" });
    expect(email.subject).toMatch(/invited/i);
    expect(email.html).toContain("https://artifact-hub.test/accept-invite?token=abc");
    expect(email.text).toContain("https://artifact-hub.test/accept-invite?token=abc");
  });
});

describe("buildNewArtifactAccessEmail", () => {
  const artifact = {
    id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    title: "<Q3> Report",
    kind: "report" as const,
    contentType: "application/pdf",
    fileName: "q3.pdf",
    sizeBytes: 2048,
  };

  it("includes title, kind, filetype, size, and a link to the artifact", () => {
    const email = buildNewArtifactAccessEmail({
      recipientName: "Ada",
      sharingUser: "Bob",
      artifact,
      appOrigin: "https://artifact-hub.test",
    });
    expect(email.html).toContain("Report");
    expect(email.html).toContain("PDF");
    expect(email.html).toContain("2.0 KB");
    expect(email.html).toContain(`https://artifact-hub.test/artifacts/${artifact.id}`);
  });

  it("subject names the sharing user, not the artifact", () => {
    const email = buildNewArtifactAccessEmail({
      recipientName: "Ada",
      sharingUser: "Bob",
      artifact,
      appOrigin: "https://artifact-hub.test",
    });
    expect(email.subject).toBe("Bob shared an Artifact with you");
  });

  it("HTML-escapes the artifact title", () => {
    const email = buildNewArtifactAccessEmail({
      recipientName: null,
      sharingUser: "Bob",
      artifact,
      appOrigin: "https://artifact-hub.test",
    });
    expect(email.html).toContain("&lt;Q3&gt; Report");
    expect(email.html).not.toContain("<Q3> Report");
  });

  it("falls back to a generic greeting when recipientName is null", () => {
    const email = buildNewArtifactAccessEmail({
      recipientName: null,
      sharingUser: "Bob",
      artifact,
      appOrigin: "https://artifact-hub.test",
    });
    expect(email.html).toContain("Hi,");
  });
});

describe("buildAccessRevokedEmail", () => {
  it("names the artifact and has no CTA (the recipient can no longer view it)", () => {
    const email = buildAccessRevokedEmail({ recipientName: "Ada", artifactTitle: "Q3 Report" });
    expect(email.subject).toContain("Q3 Report");
    expect(email.html).toContain("revoked");
    expect(email.html).not.toContain("display:inline-block");
  });
});

describe("buildNewCommentEmail", () => {
  it("names the commenter and artifact, and links to the artifact", () => {
    const email = buildNewCommentEmail({
      recipientName: "Ada",
      commenterName: "Grace",
      artifactTitle: "Q3 Report",
      artifactId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      appOrigin: "https://artifact-hub.test",
    });
    expect(email.html).toContain("Grace");
    expect(email.html).toContain("Q3 Report");
    expect(email.html).toContain("https://artifact-hub.test/artifacts/3fa85f64-5717-4562-b3fc-2c963f66afa6");
  });
});
