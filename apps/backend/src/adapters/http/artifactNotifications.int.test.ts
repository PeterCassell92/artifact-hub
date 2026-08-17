import type { Express } from "express";
import type { PrismaClient, OutboxEvent } from "@prisma/client";
import request from "supertest";
import { startTestDatabase, type TestDatabase } from "../../test-support/testDatabase";

/**
 * HTTP-level coverage that Save Policy / Revoke / Comment actually enqueue the right
 * "artifact.new_access" / "artifact.access_revoked" / "artifact.new_comment" OutboxEvent rows —
 * the recipient-resolution/diff logic itself is unit/integration-tested directly in
 * database-service/artifactRecipients.int.test.ts; this confirms the route wiring.
 */
describe("artifact notification outbox wiring", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let app: Express;
  let mintTestToken: typeof import("../../auth/testTokens").mintTestToken;
  let getEnv: typeof import("../../env").getEnv;

  const API_AUDIENCE = "https://api.artifact-hub.test";

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = db.prisma;

    ({ getEnv } = await import("../../env"));
    ({ mintTestToken } = await import("../../auth/testTokens"));
    const { createApp } = await import("../../app");
    app = createApp();
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  async function makeActiveUser(email?: string) {
    return prisma.user.create({
      data: {
        email: email ?? `user-${Math.random()}@test.local`,
        name: "Test User",
        idpSub: `idp|${Math.random()}`,
        status: "active",
      },
    });
  }

  function tokenFor(idpSub: string) {
    return mintTestToken({ sub: idpSub, audience: API_AUDIENCE }, getEnv());
  }

  async function makeArtifact(over: { ownerId: string; allowedUserIds?: string[] }) {
    const artifact = await prisma.artifact.create({
      data: {
        ownerId: over.ownerId,
        title: `Notify Test ${Math.random()}`,
        fileName: "report.pdf",
        contentType: "application/pdf",
        storageKey: `artifacts/${Math.random()}`,
        sizeBytes: BigInt(1024),
        audienceType: "specific_users",
      },
    });
    for (const userId of over.allowedUserIds ?? []) {
      await prisma.artifactAllowedUser.create({ data: { artifactId: artifact.id, userId } });
    }
    return artifact;
  }

  function newAccessEventsFor(artifactId: string): Promise<OutboxEvent[]> {
    return prisma.outboxEvent.findMany({ where: { type: "artifact.new_access" } }).then((rows) =>
      rows.filter((r) => (r.payload as { artifactId?: string }).artifactId === artifactId),
    );
  }

  describe("PUT /api/artifacts/:id/policy", () => {
    it("narrowing the audience enqueues no new-access events", async () => {
      const owner = await makeActiveUser();
      const a = await makeActiveUser();
      const b = await makeActiveUser();
      const artifact = await makeArtifact({ ownerId: owner.id, allowedUserIds: [a.id, b.id] });

      await request(app)
        .put(`/api/artifacts/${artifact.id}/policy`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ audienceType: "specific_users", userEmails: [a.email], expiry: "never" })
        .expect(200);

      expect(await newAccessEventsFor(artifact.id)).toEqual([]);
    });

    it("widening the audience enqueues exactly one new-access event for the newly-added user", async () => {
      const owner = await makeActiveUser();
      const existing = await makeActiveUser();
      const added = await makeActiveUser();
      const artifact = await makeArtifact({ ownerId: owner.id, allowedUserIds: [existing.id] });

      await request(app)
        .put(`/api/artifacts/${artifact.id}/policy`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ audienceType: "specific_users", userEmails: [existing.email, added.email], expiry: "never" })
        .expect(200);

      const events = await newAccessEventsFor(artifact.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({ recipientUserId: added.id });
    });
  });

  describe("POST /api/artifacts/:id/revoke", () => {
    it("enqueues one access_revoked event per current recipient, none for the owner", async () => {
      const owner = await makeActiveUser();
      const recipient = await makeActiveUser();
      const artifact = await makeArtifact({ ownerId: owner.id, allowedUserIds: [recipient.id] });

      await request(app)
        .post(`/api/artifacts/${artifact.id}/revoke`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      const events = await prisma.outboxEvent
        .findMany({ where: { type: "artifact.access_revoked" } })
        .then((rows) => rows.filter((r) => (r.payload as { artifactId?: string }).artifactId === artifact.id));

      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({ recipientUserId: recipient.id });
    });
  });

  describe("POST /api/artifacts/:id/comments", () => {
    it("notifies the owner and prior distinct commenters, excluding the new commenter", async () => {
      const owner = await makeActiveUser();
      const firstCommenter = await makeActiveUser();
      const secondCommenter = await makeActiveUser();
      const artifact = await makeArtifact({
        ownerId: owner.id,
        allowedUserIds: [firstCommenter.id, secondCommenter.id],
      });

      await request(app)
        .post(`/api/artifacts/${artifact.id}/comments`)
        .set("Authorization", `Bearer ${tokenFor(firstCommenter.idpSub as string)}`)
        .send({ body: "First comment" })
        .expect(201);

      await request(app)
        .post(`/api/artifacts/${artifact.id}/comments`)
        .set("Authorization", `Bearer ${tokenFor(secondCommenter.idpSub as string)}`)
        .send({ body: "Second comment" })
        .expect(201);

      const events = await prisma.outboxEvent
        .findMany({ where: { type: "artifact.new_comment" } })
        .then((rows) => rows.filter((r) => (r.payload as { artifactId?: string }).artifactId === artifact.id));

      // 1st comment (by firstCommenter): notifies owner only (no prior commenters yet).
      // 2nd comment (by secondCommenter): notifies owner + firstCommenter, not secondCommenter itself.
      const recipientIds = events.map((e) => (e.payload as { recipientUserId: string }).recipientUserId);
      expect(recipientIds.filter((id) => id === owner.id)).toHaveLength(2);
      expect(recipientIds.filter((id) => id === firstCommenter.id)).toHaveLength(1);
      expect(recipientIds).not.toContain(secondCommenter.id);
    });
  });
});
