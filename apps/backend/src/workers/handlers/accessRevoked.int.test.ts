import type { PrismaClient } from "@prisma/client";
import { startTestDatabase, type TestDatabase } from "../../test-support/testDatabase";
import { findCaughtMessageTo } from "../../test-support/mailcatcher";

describe("sendAccessRevokedEmail", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let sendAccessRevokedEmail: typeof import("./accessRevoked").sendAccessRevokedEmail;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = db.prisma;
    ({ sendAccessRevokedEmail } = await import("./accessRevoked"));
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  async function makeArtifact() {
    const owner = await prisma.user.create({
      data: { email: `owner-${Math.random()}@test.local`, name: "Test Owner", idpSub: `idp|${Math.random()}`, status: "active" },
    });
    return prisma.artifact.create({
      data: {
        ownerId: owner.id,
        title: `Confidential Draft ${Math.random()}`,
        fileName: "draft.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        storageKey: `artifacts/${Math.random()}`,
        sizeBytes: BigInt(1024),
        audienceType: "specific_users",
        revoked: true,
      },
    });
  }

  it("sends an email naming the revoked artifact", async () => {
    const artifact = await makeArtifact();
    const recipientEmail = `recipient-${Math.random()}@test.local`;
    const since = Date.now();

    await sendAccessRevokedEmail({
      artifactId: artifact.id,
      recipientUserId: "unused",
      recipientEmail,
      recipientName: "Ada",
    });

    const message = await findCaughtMessageTo(recipientEmail, since);
    expect(message.subject).toContain(artifact.title);
    expect(message.html).toContain("revoked");
  }, 15_000);

  it("throws (so the outbox retries) when the payload is malformed", async () => {
    await expect(sendAccessRevokedEmail({ artifactId: "only-an-id" })).rejects.toThrow();
  });
});
