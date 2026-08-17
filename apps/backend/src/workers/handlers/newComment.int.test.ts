import type { PrismaClient } from "@prisma/client";
import { startTestDatabase, type TestDatabase } from "../../test-support/testDatabase";
import { findCaughtMessageTo } from "../../test-support/mailcatcher";

describe("sendNewCommentEmail", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let sendNewCommentEmail: typeof import("./newComment").sendNewCommentEmail;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = db.prisma;
    ({ sendNewCommentEmail } = await import("./newComment"));
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
        title: `Design Review ${Math.random()}`,
        fileName: "design.png",
        contentType: "image/png",
        storageKey: `artifacts/${Math.random()}`,
        sizeBytes: BigInt(512),
        audienceType: "specific_users",
      },
    });
  }

  it("sends an email naming the commenter and the artifact", async () => {
    const artifact = await makeArtifact();
    const recipientEmail = `recipient-${Math.random()}@test.local`;
    const since = Date.now();

    await sendNewCommentEmail({
      artifactId: artifact.id,
      commentId: "unused",
      recipientUserId: "unused",
      recipientEmail,
      recipientName: "Ada",
      commenterName: "Grace Hopper",
    });

    const message = await findCaughtMessageTo(recipientEmail, since);
    expect(message.subject).toContain(artifact.title);
    expect(message.html).toContain("Grace Hopper");
  }, 15_000);

  it("throws (so the outbox retries) when the payload is malformed", async () => {
    await expect(sendNewCommentEmail({ artifactId: "only-an-id" })).rejects.toThrow();
  });
});
