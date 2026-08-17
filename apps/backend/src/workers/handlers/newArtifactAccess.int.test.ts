import type { PrismaClient } from "@prisma/client";
import { startTestDatabase, type TestDatabase } from "../../test-support/testDatabase";
import { findCaughtMessageTo } from "../../test-support/mailcatcher";

describe("sendNewArtifactAccessEmail", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let sendNewArtifactAccessEmail: typeof import("./newArtifactAccess").sendNewArtifactAccessEmail;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = db.prisma;
    ({ sendNewArtifactAccessEmail } = await import("./newArtifactAccess"));
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  async function makeArtifact() {
    const owner = await prisma.user.create({
      data: { email: `owner-${Math.random()}@test.local`, idpSub: `idp|${Math.random()}`, status: "active" },
    });
    return prisma.artifact.create({
      data: {
        ownerId: owner.id,
        title: `Q3 Report ${Math.random()}`,
        fileName: "q3.pdf",
        contentType: "application/pdf",
        kind: "report",
        storageKey: `artifacts/${Math.random()}`,
        sizeBytes: BigInt(2048),
        audienceType: "specific_users",
      },
    });
  }

  it("sends an email with the artifact's title, kind, filetype, and size", async () => {
    const artifact = await makeArtifact();
    const recipientEmail = `recipient-${Math.random()}@test.local`;
    const since = Date.now();

    await sendNewArtifactAccessEmail({
      artifactId: artifact.id,
      recipientUserId: "unused",
      recipientEmail,
      recipientName: "Ada",
    });

    const message = await findCaughtMessageTo(recipientEmail, since);
    expect(message.subject).toContain(artifact.title);
    expect(message.html).toContain("Report");
    expect(message.html).toContain("PDF");
    expect(message.html).toContain("2.0 KB");
  }, 15_000);

  it("throws (so the outbox retries) when the payload is malformed", async () => {
    await expect(sendNewArtifactAccessEmail({ artifactId: "only-an-id" })).rejects.toThrow();
  });

  it("throws (so the outbox retries) when the artifact no longer exists", async () => {
    await expect(
      sendNewArtifactAccessEmail({
        artifactId: "00000000-0000-0000-0000-000000000000",
        recipientEmail: `missing-${Math.random()}@test.local`,
        recipientName: null,
      }),
    ).rejects.toThrow();
  });
});
