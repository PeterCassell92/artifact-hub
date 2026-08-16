import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { startTestDatabase, type TestDatabase } from "../../test-support/testDatabase";

/**
 * Phase 2 vertical slice (implementation-plan.md): auth + core authz + Prisma + AccessEvent
 * end to end on the read path. Drives the real createApp() (unlike Phase 1's tokenValidation
 * tests, which used a purpose-built app) since real /api/artifacts* routes now exist.
 */
describe("GET /api/artifacts*", () => {
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

  async function makeActiveUser(email: string) {
    return prisma.user.create({
      data: { email, idpSub: `idp|${email}`, status: "active" },
    });
  }

  function tokenFor(idpSub: string) {
    return mintTestToken({ sub: idpSub, audience: API_AUDIENCE }, getEnv());
  }

  const future = new Date(Date.now() + 60 * 60 * 1000);
  const past = new Date(Date.now() - 60 * 60 * 1000);

  async function makeArtifact(over: {
    ownerId: string;
    title?: string;
    audienceType?: "public_authenticated" | "specific_users" | "user_groups";
    expiresAt?: Date | null;
    allowedUserIds?: string[];
    allowedGroupIds?: string[];
  }) {
    const artifact = await prisma.artifact.create({
      data: {
        ownerId: over.ownerId,
        title: over.title ?? "Untitled",
        fileName: "report.pdf",
        contentType: "application/pdf",
        storageKey: `artifacts/${Math.random()}`,
        sizeBytes: BigInt(1024),
        audienceType: over.audienceType ?? "specific_users",
        expiresAt: over.expiresAt ?? null,
      },
    });

    for (const userId of over.allowedUserIds ?? []) {
      await prisma.artifactAllowedUser.create({ data: { artifactId: artifact.id, userId } });
    }
    for (const groupId of over.allowedGroupIds ?? []) {
      await prisma.artifactAllowedGroup.create({ data: { artifactId: artifact.id, groupId } });
    }

    return artifact;
  }

  describe("GET /api/artifacts (My Artifacts)", () => {
    it("lists only the caller's own artifacts", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const other = await makeActiveUser(`other-${Math.random()}@test.local`);
      await makeArtifact({ ownerId: owner.id, title: "Mine 1" });
      await makeArtifact({ ownerId: owner.id, title: "Mine 2" });
      await makeArtifact({ ownerId: other.id, title: "Not mine" });

      const res = await request(app)
        .get("/api/artifacts")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items.map((a: { title: string }) => a.title).sort()).toEqual(["Mine 1", "Mine 2"]);
    });

    it("rejects scope=sharedWithMe (not yet supported)", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      await request(app)
        .get("/api/artifacts?scope=sharedWithMe")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(400);
    });
  });

  describe("GET /api/artifacts/:id", () => {
    it("404s for an unknown artifact id", async () => {
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      await request(app)
        .get("/api/artifacts/00000000-0000-0000-0000-000000000000")
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(404);
    });

    it("200s for a user in the audience and writes an allowed AccessEvent", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const artifact = await makeArtifact({
        ownerId: owner.id,
        audienceType: "specific_users",
        allowedUserIds: [viewer.id],
      });

      const res = await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(200);

      expect(res.body.id).toBe(artifact.id);
      expect(res.body.canManagePolicy).toBe(false);

      const events = await prisma.accessEvent.findMany({ where: { artifactId: artifact.id } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: viewer.id,
        route: "ui",
        action: "view",
        decision: "allowed",
      });
    });

    it("403s for a user outside the audience and writes a denied AccessEvent", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const outsider = await makeActiveUser(`outsider-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "specific_users" });

      await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(outsider.idpSub as string)}`)
        .expect(403);

      const events = await prisma.accessEvent.findMany({ where: { artifactId: artifact.id } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: outsider.id,
        decision: "denied",
        denyReason: "not_in_audience",
      });
    });

    it("403s once expired for a non-owner in the audience", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const artifact = await makeArtifact({
        ownerId: owner.id,
        audienceType: "specific_users",
        allowedUserIds: [viewer.id],
        expiresAt: past,
      });

      const res = await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(403);

      expect(res.body.error.details.reason).toBe("expired");
    });

    it("200s for the owner even after expiry (My Artifacts)", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, expiresAt: past });

      const res = await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      expect(res.body.canManagePolicy).toBe(true);
      expect(res.body.isExpired).toBe(true);
    });

    it("200s for public_authenticated to any active user, not expired", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const anyone = await makeActiveUser(`anyone-${Math.random()}@test.local`);
      const artifact = await makeArtifact({
        ownerId: owner.id,
        audienceType: "public_authenticated",
        expiresAt: future,
      });

      await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(anyone.idpSub as string)}`)
        .expect(200);
    });

    it("200s for a user via group membership (user_groups)", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const groupMember = await makeActiveUser(`member-${Math.random()}@test.local`);
      const group = await prisma.group.create({ data: { name: `group-${Math.random()}` } });
      await prisma.groupMembership.create({ data: { userId: groupMember.id, groupId: group.id } });

      const artifact = await makeArtifact({
        ownerId: owner.id,
        audienceType: "user_groups",
        allowedGroupIds: [group.id],
      });

      await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(groupMember.idpSub as string)}`)
        .expect(200);
    });
  });

  describe("GET /api/artifacts/:id/comments", () => {
    it("200s with comments for a user who can view", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id });
      await prisma.comment.create({
        data: { artifactId: artifact.id, authorId: owner.id, body: "First!" },
      });

      const res = await request(app)
        .get(`/api/artifacts/${artifact.id}/comments`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ body: "First!" });
    });

    it("403s for a user who cannot view", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const outsider = await makeActiveUser(`outsider-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "specific_users" });

      await request(app)
        .get(`/api/artifacts/${artifact.id}/comments`)
        .set("Authorization", `Bearer ${tokenFor(outsider.idpSub as string)}`)
        .expect(403);
    });
  });
});
