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
      data: { email, name: "Test User", idpSub: `idp|${email}`, status: "active" },
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
    description?: string;
    fileName?: string;
    contentType?: string;
    kind?: "diagram" | "document" | "image" | "report" | "data" | "other";
    sourceTool?: string;
    tags?: string[];
    audienceType?: "public_authenticated" | "specific_users" | "user_groups";
    expiresAt?: Date | null;
    allowedUserIds?: string[];
    allowedGroupIds?: string[];
    createdAt?: Date;
  }) {
    const artifact = await prisma.artifact.create({
      data: {
        ownerId: over.ownerId,
        title: over.title ?? "Untitled",
        description: over.description,
        fileName: over.fileName ?? "report.pdf",
        contentType: over.contentType ?? "application/pdf",
        kind: over.kind ?? "other",
        sourceTool: over.sourceTool,
        storageKey: `artifacts/${Math.random()}`,
        sizeBytes: BigInt(1024),
        audienceType: over.audienceType ?? "specific_users",
        expiresAt: over.expiresAt ?? null,
        ...(over.createdAt ? { createdAt: over.createdAt } : {}),
      },
    });

    for (const userId of over.allowedUserIds ?? []) {
      await prisma.artifactAllowedUser.create({ data: { artifactId: artifact.id, userId } });
    }
    for (const groupId of over.allowedGroupIds ?? []) {
      await prisma.artifactAllowedGroup.create({ data: { artifactId: artifact.id, groupId } });
    }
    for (const name of over.tags ?? []) {
      const tag = await prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
      await prisma.artifactTag.create({ data: { artifactId: artifact.id, tagId: tag.id } });
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

  });

  describe("GET /api/artifacts?scope=sharedWithMe", () => {
    // Global-visibility scope, so other tests' public_authenticated rows can be visible here too
    // (same test-container DB, no per-test reset) — assert containment, not exact list equality.
    it("lists visible artifacts I don't own, excluding scope=mine", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const title = `Public ${Math.random()}`;
      await makeArtifact({ ownerId: owner.id, title, audienceType: "public_authenticated" });
      const ownTitle = `Own ${Math.random()}`;
      await makeArtifact({ ownerId: viewer.id, title: ownTitle });

      const shared = await request(app)
        .get("/api/artifacts?scope=sharedWithMe")
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(200);
      const sharedTitles = shared.body.items.map((a: { title: string }) => a.title);
      expect(sharedTitles).toContain(title);
      expect(sharedTitles).not.toContain(ownTitle);

      const mine = await request(app)
        .get("/api/artifacts?scope=mine")
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(200);
      expect(mine.body.items.map((a: { title: string }) => a.title)).toEqual([ownTitle]);
    });

    it("sinceHours excludes artifacts published outside the window", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const recentTitle = `Recent ${Math.random()}`;
      await makeArtifact({
        ownerId: owner.id,
        title: recentTitle,
        audienceType: "public_authenticated",
      });
      const oldTitle = `Old ${Math.random()}`;
      const old = await makeArtifact({
        ownerId: owner.id,
        title: oldTitle,
        audienceType: "public_authenticated",
      });
      await prisma.artifact.update({
        where: { id: old.id },
        data: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      });

      const res = await request(app)
        .get("/api/artifacts?scope=sharedWithMe&sinceHours=24")
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(200);

      const titles = res.body.items.map((a: { title: string }) => a.title);
      expect(titles).toContain(recentTitle);
      expect(titles).not.toContain(oldTitle);
    });
  });

  describe("GET /api/artifacts — filters/sort (Phase 7)", () => {
    it("q matches title, description, and fileName", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const marker = `zzq${Math.random().toString(36).slice(2)}`;
      const byTitle = await makeArtifact({ ownerId: owner.id, title: `Report ${marker}` });
      const byDescription = await makeArtifact({
        ownerId: owner.id,
        title: "Untitled",
        description: `notes about ${marker}`,
      });
      const byFileName = await makeArtifact({ ownerId: owner.id, fileName: `${marker}.pdf` });
      const nonMatch = await makeArtifact({ ownerId: owner.id, title: "Unrelated" });

      const res = await request(app)
        .get(`/api/artifacts?q=${marker}`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      const ids = res.body.items.map((a: { id: string }) => a.id);
      expect(ids).toEqual(expect.arrayContaining([byTitle.id, byDescription.id, byFileName.id]));
      expect(ids).not.toContain(nonMatch.id);
    });

    it("contentType, kind, sourceTool, and tags filter down My Artifacts", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const tag = `tag-${Math.random()}`;
      const match = await makeArtifact({
        ownerId: owner.id,
        contentType: "image/png",
        kind: "image",
        sourceTool: "Claude Desktop",
        tags: [tag],
      });
      const nonMatch = await makeArtifact({ ownerId: owner.id, contentType: "application/pdf", kind: "document" });

      async function idsFor(query: string) {
        const res = await request(app)
          .get(`/api/artifacts?${query}`)
          .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
          .expect(200);
        return res.body.items.map((a: { id: string }) => a.id);
      }

      expect(await idsFor("contentType=image%2Fpng")).toEqual([match.id]);
      expect(await idsFor("kind=image")).toEqual([match.id]);
      expect(await idsFor("sourceTool=Claude%20Desktop")).toEqual([match.id]);
      expect(await idsFor(`tags=${tag}`)).toEqual([match.id]);
      expect(await idsFor("kind=document")).toEqual([nonMatch.id]);
    });

    it("audienceType and isExpired filter My Artifacts (ignored on Shared With Me)", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const publicOne = await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });
      const expiredOne = await makeArtifact({ ownerId: owner.id, expiresAt: past });

      const byAudience = await request(app)
        .get("/api/artifacts?audienceType=public_authenticated")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);
      expect(byAudience.body.items.map((a: { id: string }) => a.id)).toEqual([publicOne.id]);

      const expired = await request(app)
        .get("/api/artifacts?isExpired=true")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);
      expect(expired.body.items.map((a: { id: string }) => a.id)).toEqual([expiredOne.id]);

      const active = await request(app)
        .get("/api/artifacts?isExpired=false")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);
      const activeIds = active.body.items.map((a: { id: string }) => a.id);
      expect(activeIds).toContain(publicOne.id);
      expect(activeIds).not.toContain(expiredOne.id);
    });

    it("publisherId filters Shared With Me to the selected owner(s)", async () => {
      const ownerA = await makeActiveUser(`ownera-${Math.random()}@test.local`);
      const ownerB = await makeActiveUser(`ownerb-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const fromA = await makeArtifact({ ownerId: ownerA.id, audienceType: "public_authenticated" });
      const fromB = await makeArtifact({ ownerId: ownerB.id, audienceType: "public_authenticated" });

      const res = await request(app)
        .get(`/api/artifacts?scope=sharedWithMe&publisherId=${ownerA.id}`)
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(200);

      const ids = res.body.items.map((a: { id: string }) => a.id);
      expect(ids).toContain(fromA.id);
      expect(ids).not.toContain(fromB.id);
    });

    it("sort=title orders alphabetically and sort=size orders by sizeBytes desc", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const marker = Math.random().toString(36).slice(2);
      const a = await makeArtifact({ ownerId: owner.id, title: `A-${marker}` });
      const b = await makeArtifact({ ownerId: owner.id, title: `B-${marker}` });
      await prisma.artifact.update({ where: { id: a.id }, data: { sizeBytes: BigInt(9999) } });
      await prisma.artifact.update({ where: { id: b.id }, data: { sizeBytes: BigInt(1) } });

      const byTitle = await request(app)
        .get(`/api/artifacts?q=${marker}&sort=title`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);
      expect(byTitle.body.items.map((x: { id: string }) => x.id)).toEqual([a.id, b.id]);

      const bySize = await request(app)
        .get(`/api/artifacts?q=${marker}&sort=size`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);
      expect(bySize.body.items.map((x: { id: string }) => x.id)).toEqual([a.id, b.id]);
    });

    it("sort=lastAccessed orders by the most recently (allowed-)accessed artifact first", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const marker = Math.random().toString(36).slice(2);
      const stale = await makeArtifact({ ownerId: owner.id, title: `Stale-${marker}` });
      const fresh = await makeArtifact({ ownerId: owner.id, title: `Fresh-${marker}` });
      const neverAccessed = await makeArtifact({ ownerId: owner.id, title: `Never-${marker}` });

      // GET /api/artifacts/:id records an allowed AccessEvent and touches lastAccessedAt.
      await request(app)
        .get(`/api/artifacts/${stale.id}`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);
      await request(app)
        .get(`/api/artifacts/${fresh.id}`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      const res = await request(app)
        .get(`/api/artifacts?q=${marker}&sort=lastAccessed`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      const ids = res.body.items.map((x: { id: string }) => x.id);
      expect(ids.indexOf(fresh.id)).toBeLessThan(ids.indexOf(stale.id));
      expect(ids.indexOf(stale.id)).toBeLessThan(ids.indexOf(neverAccessed.id));
    });
  });

  describe("GET /api/artifacts/facets", () => {
    it("returns distinct contentType/tag/sourceTool values visible to the caller (scope=mine)", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const marker = `facet-${Math.random()}`;
      await makeArtifact({
        ownerId: owner.id,
        contentType: `application/${marker}`,
        sourceTool: `Tool-${marker}`,
        tags: [marker],
      });

      const res = await request(app)
        .get("/api/artifacts/facets?scope=mine")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      expect(res.body.contentTypes).toContain(`application/${marker}`);
      expect(res.body.sourceTools).toContain(`Tool-${marker}`);
      expect(res.body.tags).toContain(marker);
      expect(res.body.publishers).toEqual([]);
    });

    it("returns distinct publishers for scope=sharedWithMe", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

      const res = await request(app)
        .get("/api/artifacts/facets?scope=sharedWithMe")
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(200);

      expect(res.body.publishers.map((p: { id: string }) => p.id)).toContain(owner.id);
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

    it("returns the owner's display name as publisherName — every user has one (name is NOT NULL)", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

      const res = await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      expect(res.body.publisherName).toBe(owner.name);
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

  describe("GET /api/artifacts/:id/access-events", () => {
    async function seedEvent(over: { artifactId: string; userId: string; decision: "allowed" | "denied"; denyReason?: string; at?: Date }) {
      return prisma.accessEvent.create({
        data: {
          artifactId: over.artifactId,
          userId: over.userId,
          route: "ui",
          action: "view",
          decision: over.decision,
          denyReason: over.denyReason,
          at: over.at ?? new Date(),
        },
      });
    }

    it("200s for the owner, newest first, including denied attempts", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });
      await seedEvent({ artifactId: artifact.id, userId: viewer.id, decision: "allowed", at: past });
      await seedEvent({
        artifactId: artifact.id,
        userId: viewer.id,
        decision: "denied",
        denyReason: "revoked",
        at: future,
      });

      const res = await request(app)
        .get(`/api/artifacts/${artifact.id}/access-events`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0]).toMatchObject({
        userId: viewer.id,
        userName: viewer.name,
        userEmail: viewer.email,
        decision: "denied",
        denyReason: "revoked",
      });
      expect(res.body.items[1]).toMatchObject({ decision: "allowed" });
      expect(res.body.nextCursor).toBeNull();
    });

    it("200s for an admin who does not own the artifact", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const admin = await prisma.user.create({
        data: { email: `admin-${Math.random()}@test.local`, name: "Admin", idpSub: `idp|${Math.random()}`, status: "active", role: "admin" },
      });
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });
      await seedEvent({ artifactId: artifact.id, userId: owner.id, decision: "allowed" });

      await request(app)
        .get(`/api/artifacts/${artifact.id}/access-events`)
        .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
        .expect(200);
    });

    it("403s for a non-owner, non-admin viewer even if they can view the artifact", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

      await request(app)
        .get(`/api/artifacts/${artifact.id}/access-events`)
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(403);
    });

    it("404s for an unknown artifact id", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      await request(app)
        .get("/api/artifacts/00000000-0000-0000-0000-000000000000/access-events")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(404);
    });

    it("returns an empty list, not an error, for a fresh artifact with no access events", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id });

      const res = await request(app)
        .get(`/api/artifacts/${artifact.id}/access-events`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      expect(res.body).toEqual({ items: [], nextCursor: null });
    });

    it("paginates with cursor/limit, newest first", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id });
      for (let i = 0; i < 3; i++) {
        await seedEvent({ artifactId: artifact.id, userId: viewer.id, decision: "allowed", at: new Date(Date.now() + i * 1000) });
      }

      const first = await request(app)
        .get(`/api/artifacts/${artifact.id}/access-events?limit=2`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);
      expect(first.body.items).toHaveLength(2);
      expect(first.body.nextCursor).toEqual(expect.any(String));

      const second = await request(app)
        .get(`/api/artifacts/${artifact.id}/access-events?limit=2&cursor=${first.body.nextCursor}`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.nextCursor).toBeNull();
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

  describe("POST /api/artifacts/:id/comments", () => {
    it("201s and attributes the comment to the caller", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id });

      const res = await request(app)
        .post(`/api/artifacts/${artifact.id}/comments`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ body: "Nice work!" })
        .expect(201);

      expect(res.body).toMatchObject({ body: "Nice work!" });
      const stored = await prisma.comment.findMany({ where: { artifactId: artifact.id } });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ authorId: owner.id, body: "Nice work!" });
    });

    it("403s for a user who cannot view (canComment = canView)", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const outsider = await makeActiveUser(`outsider-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "specific_users" });

      await request(app)
        .post(`/api/artifacts/${artifact.id}/comments`)
        .set("Authorization", `Bearer ${tokenFor(outsider.idpSub as string)}`)
        .send({ body: "Sneaky" })
        .expect(403);
    });
  });

  describe("GET /api/artifacts/:id/relationships", () => {
    it("200s with relationships in both directions, resolving the other artifact when viewable", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const a = await makeArtifact({ ownerId: owner.id, title: "Source diagram" });
      const b = await makeArtifact({ ownerId: owner.id, title: "Compiled PDF" });
      await prisma.artifactRelationship.create({
        data: { fromId: b.id, toId: a.id, type: "derived_from", note: "compiled export", createdById: owner.id },
      });

      const res = await request(app)
        .get(`/api/artifacts/${a.id}/relationships`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        type: "derived_from",
        direction: "incoming",
        note: "compiled export",
        otherArtifact: { id: b.id, title: "Compiled PDF" },
      });
    });

    it("redacts the other artifact when the caller cannot view it", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const shared = await makeArtifact({
        ownerId: owner.id,
        title: "Shared with viewer",
        audienceType: "specific_users",
        allowedUserIds: [viewer.id],
      });
      const secret = await makeArtifact({ ownerId: owner.id, title: "Private", audienceType: "specific_users" });
      await prisma.artifactRelationship.create({
        data: { fromId: shared.id, toId: secret.id, type: "related_to", createdById: owner.id },
      });

      const res = await request(app)
        .get(`/api/artifacts/${shared.id}/relationships`)
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].otherArtifact).toBeNull();
    });

    it("403s for a user who cannot view the artifact itself", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const outsider = await makeActiveUser(`outsider-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "specific_users" });

      await request(app)
        .get(`/api/artifacts/${artifact.id}/relationships`)
        .set("Authorization", `Bearer ${tokenFor(outsider.idpSub as string)}`)
        .expect(403);
    });
  });

  describe("POST /api/artifacts/:id/relationships", () => {
    it("201s and persists for the owner linking to a viewable target", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const from = await makeArtifact({ ownerId: owner.id });
      const to = await makeArtifact({ ownerId: owner.id });

      const res = await request(app)
        .post(`/api/artifacts/${from.id}/relationships`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ toId: to.id, type: "supersedes" })
        .expect(201);

      expect(res.body).toMatchObject({ relationshipId: expect.any(String) });
      const stored = await prisma.artifactRelationship.findMany({ where: { fromId: from.id } });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ toId: to.id, type: "supersedes", createdById: owner.id });
    });

    it("403s for a non-owner of fromId", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const outsider = await makeActiveUser(`outsider-${Math.random()}@test.local`);
      const from = await makeArtifact({ ownerId: owner.id });
      const to = await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

      await request(app)
        .post(`/api/artifacts/${from.id}/relationships`)
        .set("Authorization", `Bearer ${tokenFor(outsider.idpSub as string)}`)
        .send({ toId: to.id, type: "related_to" })
        .expect(403);
    });

    it("403s when toId is not viewable by the caller", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const from = await makeArtifact({ ownerId: owner.id });
      const secret = await makeArtifact({
        ownerId: (await makeActiveUser(`other-${Math.random()}@test.local`)).id,
        audienceType: "specific_users",
      });

      await request(app)
        .post(`/api/artifacts/${from.id}/relationships`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ toId: secret.id, type: "related_to" })
        .expect(403);
    });

    it("400s on a self-link", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id });

      await request(app)
        .post(`/api/artifacts/${artifact.id}/relationships`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ toId: artifact.id, type: "related_to" })
        .expect(400);
    });

    it("409s on a duplicate (fromId, toId, type)", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const from = await makeArtifact({ ownerId: owner.id });
      const to = await makeArtifact({ ownerId: owner.id });
      await prisma.artifactRelationship.create({
        data: { fromId: from.id, toId: to.id, type: "related_to", createdById: owner.id },
      });

      await request(app)
        .post(`/api/artifacts/${from.id}/relationships`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ toId: to.id, type: "related_to" })
        .expect(409);
    });
  });

  describe("DELETE /api/artifacts/:id/relationships/:relationshipId", () => {
    it("204s and removes the relationship for the owner of fromId", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const from = await makeArtifact({ ownerId: owner.id });
      const to = await makeArtifact({ ownerId: owner.id });
      const relationship = await prisma.artifactRelationship.create({
        data: { fromId: from.id, toId: to.id, type: "related_to", createdById: owner.id },
      });

      await request(app)
        .delete(`/api/artifacts/${from.id}/relationships/${relationship.id}`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(204);

      const stored = await prisma.artifactRelationship.findUnique({ where: { id: relationship.id } });
      expect(stored).toBeNull();
    });

    it("403s for a caller who doesn't own the relationship's fromId", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const outsider = await makeActiveUser(`outsider-${Math.random()}@test.local`);
      const from = await makeArtifact({ ownerId: owner.id });
      const to = await makeArtifact({ ownerId: owner.id });
      const relationship = await prisma.artifactRelationship.create({
        data: { fromId: from.id, toId: to.id, type: "related_to", createdById: owner.id },
      });

      await request(app)
        .delete(`/api/artifacts/${from.id}/relationships/${relationship.id}`)
        .set("Authorization", `Bearer ${tokenFor(outsider.idpSub as string)}`)
        .expect(403);

      const stored = await prisma.artifactRelationship.findUnique({ where: { id: relationship.id } });
      expect(stored).not.toBeNull();
    });

    it("404s for an unknown relationshipId", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id });

      await request(app)
        .delete(`/api/artifacts/${artifact.id}/relationships/00000000-0000-0000-0000-000000000000`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(404);
    });
  });

  describe("PUT /api/artifacts/:id/policy (revocation)", () => {
    it("narrowing the audience flips a previously-allowed viewer to denied, and audits it", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const artifact = await makeArtifact({
        ownerId: owner.id,
        audienceType: "specific_users",
        allowedUserIds: [viewer.id],
      });

      await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(200);

      await request(app)
        .put(`/api/artifacts/${artifact.id}/policy`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ audienceType: "specific_users", userEmails: [owner.email], expiry: "never" })
        .expect(200);

      await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(403);

      const auditRows = await prisma.adminAuditLog.findMany({
        where: { targetType: "artifact", targetId: artifact.id, action: "policy.update" },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({ actorId: owner.id });
    });

    it("owner still sees it after narrowing (owner short-circuit)", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "specific_users" });

      await request(app)
        .put(`/api/artifacts/${artifact.id}/policy`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ audienceType: "public_authenticated", expiry: "24h" })
        .expect(200);

      await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);
    });

    it("403s a non-owner trying to change the policy", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const other = await makeActiveUser(`other-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id });

      await request(app)
        .put(`/api/artifacts/${artifact.id}/policy`)
        .set("Authorization", `Bearer ${tokenFor(other.idpSub as string)}`)
        .send({ audienceType: "public_authenticated", expiry: "never" })
        .expect(403);
    });

    it("400s for an unknown userEmail", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id });

      await request(app)
        .put(`/api/artifacts/${artifact.id}/policy`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ audienceType: "specific_users", userEmails: ["nobody@test.local"], expiry: "never" })
        .expect(400);
    });

    it("computes the bucketed expiry relative to publishedAt, not edit time — can land in the past", async () => {
      // Published 10 days ago; choosing "7d" here means "7 days after publish", which already
      // elapsed 3 days ago — not "7 days from right now". Editing the policy without touching
      // expiry shouldn't silently push the deadline further out just because time passed.
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const publishedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const artifact = await makeArtifact({ ownerId: owner.id, createdAt: publishedAt });

      const res = await request(app)
        .put(`/api/artifacts/${artifact.id}/policy`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ audienceType: "public_authenticated", expiry: "7d" })
        .expect(200);

      const expectedExpiresAt = new Date(publishedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      expect(new Date(res.body.expiresAt).getTime()).toBe(expectedExpiresAt.getTime());
      expect(res.body.isExpired).toBe(true);
    });
  });

  describe("POST /api/artifacts/:id/revoke", () => {
    it("immediately cuts off non-owners while the owner keeps access, and audits it", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

      await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(200);

      const res = await request(app)
        .post(`/api/artifacts/${artifact.id}/revoke`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);
      expect(res.body.revoked).toBe(true);

      const denied = await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(403);
      expect(denied.body.error.details.reason).toBe("revoked");

      await request(app)
        .get(`/api/artifacts/${artifact.id}`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      const auditRows = await prisma.adminAuditLog.findMany({
        where: { targetType: "artifact", targetId: artifact.id, action: "policy.revoke" },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({ actorId: owner.id });
    });

    it("403s a non-owner trying to revoke", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const other = await makeActiveUser(`other-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

      await request(app)
        .post(`/api/artifacts/${artifact.id}/revoke`)
        .set("Authorization", `Bearer ${tokenFor(other.idpSub as string)}`)
        .expect(403);
    });

    it("saving a new policy on a revoked artifact clears the revoked flag", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

      await request(app)
        .post(`/api/artifacts/${artifact.id}/revoke`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      const res = await request(app)
        .put(`/api/artifacts/${artifact.id}/policy`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ audienceType: "public_authenticated", expiry: "never" })
        .expect(200);

      expect(res.body.revoked).toBe(false);
    });
  });

  describe("POST /api/artifacts/:id/share-links + GET /api/s/:token (redemption)", () => {
    it("mints a link that resolves and re-checks canView live", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const artifact = await makeArtifact({
        ownerId: owner.id,
        audienceType: "specific_users",
        allowedUserIds: [viewer.id],
      });

      const created = await request(app)
        .post(`/api/artifacts/${artifact.id}/share-links`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(201);

      const token = new URL(created.body.url).pathname.split("/").pop();

      const redeemed = await request(app)
        .get(`/api/s/${token}`)
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(302);
      expect(redeemed.headers.location).toContain(`/artifacts/${artifact.id}`);

      const events = await prisma.accessEvent.findMany({
        where: { artifactId: artifact.id, route: "share_link" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ userId: viewer.id, decision: "allowed" });
    });

    it("403s once the artifact policy no longer allows the redeemer", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const outsider = await makeActiveUser(`outsider-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "specific_users" });

      const created = await request(app)
        .post(`/api/artifacts/${artifact.id}/share-links`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(201);
      const token = new URL(created.body.url).pathname.split("/").pop();

      await request(app)
        .get(`/api/s/${token}`)
        .set("Authorization", `Bearer ${tokenFor(outsider.idpSub as string)}`)
        .expect(403);
    });

    it("404s once the link itself is revoked, even if the policy would otherwise allow it", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

      const created = await request(app)
        .post(`/api/artifacts/${artifact.id}/share-links`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(201);
      const token = new URL(created.body.url).pathname.split("/").pop();

      await prisma.shareLink.update({ where: { id: created.body.id }, data: { revoked: true } });

      await request(app)
        .get(`/api/s/${token}`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(404);
    });

    it("403s a non-owner with no view access trying to mint a share link", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const other = await makeActiveUser(`other-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id });

      await request(app)
        .post(`/api/artifacts/${artifact.id}/share-links`)
        .set("Authorization", `Bearer ${tokenFor(other.idpSub as string)}`)
        .expect(403);
    });

    it("201s for a non-owner who can view the artifact — minting is canView, not owner-only", async () => {
      // A share link is a pure locator (03 §5): a non-owner viewer handing it out can never grant
      // more access than the redeemer's own canView check allows on redemption, so this is safe.
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const viewer = await makeActiveUser(`viewer-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

      const created = await request(app)
        .post(`/api/artifacts/${artifact.id}/share-links`)
        .set("Authorization", `Bearer ${tokenFor(viewer.idpSub as string)}`)
        .expect(201);

      expect(created.body.url).toContain("/s/");
    });

    it("returns JSON {artifactId} instead of a redirect when Accept: application/json", async () => {
      // The SPA's ShareLinkRedemptionPage resolves this via `fetch`, not a browser navigation.
      // A 302 to our own frontend origin still fails: once a redirect chain crosses an origin
      // boundary (backend -> frontend), the whole chain is CORS-tainted, so even the final
      // same-origin hop needs an Access-Control-Allow-Origin header it will never have. Content
      // negotiation (like /download) sidesteps the redirect entirely for JSON callers.
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

      const created = await request(app)
        .post(`/api/artifacts/${artifact.id}/share-links`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(201);
      const token = new URL(created.body.url).pathname.split("/").pop();

      const res = await request(app)
        .get(`/api/s/${token}`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .set("Accept", "application/json")
        .expect(200);

      expect(res.body.artifactId).toBe(artifact.id);
    });
  });

  describe("GET /api/artifacts/:id/download", () => {
    it("302s to a presigned URL and writes a download AccessEvent", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id });

      const res = await request(app)
        .get(`/api/artifacts/${artifact.id}/download`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(302);

      expect(res.headers.location).toContain(artifact.storageKey);

      const events = await prisma.accessEvent.findMany({
        where: { artifactId: artifact.id, action: "download" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ userId: owner.id, decision: "allowed" });
    });

    it("403s a user outside the audience and writes a denied download AccessEvent", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const outsider = await makeActiveUser(`outsider-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id, audienceType: "specific_users" });

      await request(app)
        .get(`/api/artifacts/${artifact.id}/download`)
        .set("Authorization", `Bearer ${tokenFor(outsider.idpSub as string)}`)
        .expect(403);

      const events = await prisma.accessEvent.findMany({
        where: { artifactId: artifact.id, action: "download" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.decision).toBe("denied");
    });

    it("returns JSON {url} instead of a redirect when Accept: application/json", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const artifact = await makeArtifact({ ownerId: owner.id });

      const res = await request(app)
        .get(`/api/artifacts/${artifact.id}/download`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .set("Accept", "application/json")
        .expect(200);

      expect(res.body.url).toContain(artifact.storageKey);
    });
  });

  describe("POST /api/artifacts", () => {
    it("creates a pending, private artifact and returns a presigned upload URL", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);

      const res = await request(app)
        .post("/api/artifacts")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({
          title: "report.pdf",
          fileName: "report.pdf",
          contentType: "application/pdf",
          audienceType: "specific_users",
          userEmails: [],
          expiry: "never",
        })
        .expect(201);

      expect(res.body.uploadUrl).toMatch(/^http/);

      const stored = await prisma.artifact.findUnique({ where: { id: res.body.artifactId } });
      expect(stored).toMatchObject({ ownerId: owner.id, audienceType: "specific_users" });
      expect(Number(stored!.sizeBytes)).toBe(0);
      expect(stored!.expiresAt).toBeNull();

      const allowedUsers = await prisma.artifactAllowedUser.findMany({ where: { artifactId: res.body.artifactId } });
      expect(allowedUsers).toHaveLength(0);
    });

    it("links relationships passed alongside the new artifact, reporting per-entry outcomes", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const source = await makeArtifact({ ownerId: owner.id, title: "Source diagram" });

      const res = await request(app)
        .post("/api/artifacts")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({
          title: "Compiled output",
          fileName: "out.pdf",
          contentType: "application/pdf",
          audienceType: "specific_users",
          userEmails: [],
          expiry: "never",
          relationships: [{ toId: source.id, type: "derived_from", note: "compiled export" }],
        })
        .expect(201);

      expect(res.body.relationshipResults).toEqual([
        expect.objectContaining({ ok: true, relationshipId: expect.any(String) }),
      ]);
      const stored = await prisma.artifactRelationship.findMany({ where: { fromId: res.body.artifactId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ toId: source.id, type: "derived_from", note: "compiled export" });
    });

    it("is private by default — the owner can view it immediately, nobody else can", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const other = await makeActiveUser(`other-${Math.random()}@test.local`);

      const created = await request(app)
        .post("/api/artifacts")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({
          title: "report.pdf",
          fileName: "report.pdf",
          contentType: "application/pdf",
          audienceType: "specific_users",
          userEmails: [],
          expiry: "never",
        })
        .expect(201);

      await request(app)
        .get(`/api/artifacts/${created.body.artifactId}`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      await request(app)
        .get(`/api/artifacts/${created.body.artifactId}`)
        .set("Authorization", `Bearer ${tokenFor(other.idpSub as string)}`)
        .expect(403);
    });

    it("400s when required fields are missing", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);

      await request(app)
        .post("/api/artifacts")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({ title: "Incomplete" })
        .expect(400);
    });

    it("400s for an unknown userEmail", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);

      await request(app)
        .post("/api/artifacts")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .send({
          title: "report.pdf",
          fileName: "report.pdf",
          contentType: "application/pdf",
          audienceType: "specific_users",
          userEmails: ["nobody@test.local"],
          expiry: "never",
        })
        .expect(400);
    });
  });

  describe("POST /api/artifacts/:id/finalize", () => {
    async function createPending(idpSub: string) {
      const created = await request(app)
        .post("/api/artifacts")
        .set("Authorization", `Bearer ${tokenFor(idpSub)}`)
        .send({
          title: "report.pdf",
          fileName: "report.pdf",
          contentType: "text/plain",
          audienceType: "specific_users",
          userEmails: [],
          expiry: "never",
        })
        .expect(201);
      return created.body as { artifactId: string; uploadUrl: string };
    }

    it("records the file's real size once the upload has actually landed", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const { artifactId, uploadUrl } = await createPending(owner.idpSub as string);

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        body: "the actual bytes",
        headers: { "Content-Type": "text/plain" },
      });
      expect(putRes.ok).toBe(true);

      const res = await request(app)
        .post(`/api/artifacts/${artifactId}/finalize`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(200);

      expect(res.body.sizeBytes).toBe(Buffer.byteLength("the actual bytes"));
    });

    it("413s and deletes the object when the upload exceeds the 500MB cap", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const { artifactId, uploadUrl } = await createPending(owner.idpSub as string);

      const oversized = Buffer.alloc(500 * 1024 * 1024 + 1);
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        body: oversized,
        headers: { "Content-Type": "text/plain" },
      });
      expect(putRes.ok).toBe(true);

      const res = await request(app)
        .post(`/api/artifacts/${artifactId}/finalize`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(413);
      expect(res.body.error.code).toBe("payload_too_large");
    }, 60_000);

    it("409s when the upload hasn't landed yet", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const { artifactId } = await createPending(owner.idpSub as string);

      await request(app)
        .post(`/api/artifacts/${artifactId}/finalize`)
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(409);
    });

    it("403s a non-owner trying to finalize", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);
      const other = await makeActiveUser(`other-${Math.random()}@test.local`);
      const { artifactId } = await createPending(owner.idpSub as string);

      await request(app)
        .post(`/api/artifacts/${artifactId}/finalize`)
        .set("Authorization", `Bearer ${tokenFor(other.idpSub as string)}`)
        .expect(403);
    });

    it("404s for an unknown artifact id", async () => {
      const owner = await makeActiveUser(`owner-${Math.random()}@test.local`);

      await request(app)
        .post("/api/artifacts/00000000-0000-0000-0000-000000000000/finalize")
        .set("Authorization", `Bearer ${tokenFor(owner.idpSub as string)}`)
        .expect(404);
    });
  });
});
