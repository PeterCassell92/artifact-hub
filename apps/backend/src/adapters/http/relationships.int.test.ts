import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { startTestDatabase, type TestDatabase } from "../../test-support/testDatabase";

/**
 * GET /api/relationships — corpus-wide, optionally ?type=-filtered read (docs/architecture/06
 * §2), the REST counterpart to the MCP `list_relationships` tool. Per-artifact relationship
 * routes (GET/POST/DELETE .../:id/relationships) are covered in artifacts.int.test.ts.
 */
describe("GET /api/relationships", () => {
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

  async function makeArtifact(over: {
    ownerId: string;
    title?: string;
    audienceType?: "public_authenticated" | "specific_users" | "user_groups";
    allowedUserIds?: string[];
  }) {
    const artifact = await prisma.artifact.create({
      data: {
        ownerId: over.ownerId,
        title: over.title ?? "Untitled",
        fileName: "report.pdf",
        contentType: "application/pdf",
        kind: "other",
        storageKey: `artifacts/${Math.random()}`,
        sizeBytes: BigInt(1024),
        audienceType: over.audienceType ?? "specific_users",
      },
    });
    for (const userId of over.allowedUserIds ?? []) {
      await prisma.artifactAllowedUser.create({ data: { artifactId: artifact.id, userId } });
    }
    return artifact;
  }

  it("returns a row when the caller can view either side, redacting the other, and excludes rows where neither side is viewable", async () => {
    const caller = await makeActiveUser(`caller-${Math.random()}@test.local`);
    const other = await makeActiveUser(`other-${Math.random()}@test.local`);
    const stranger = await makeActiveUser(`stranger-${Math.random()}@test.local`);

    const mine = await makeArtifact({ ownerId: caller.id, title: "Mine" });
    const mineTarget = await makeArtifact({ ownerId: caller.id, title: "Mine target" });
    await prisma.artifactRelationship.create({
      data: { fromId: mine.id, toId: mineTarget.id, type: "related_to", createdById: caller.id },
    });

    const shared = await makeArtifact({
      ownerId: other.id,
      title: "Shared",
      audienceType: "specific_users",
      allowedUserIds: [caller.id],
    });
    const otherPrivate = await makeArtifact({ ownerId: other.id, title: "Other private" });
    await prisma.artifactRelationship.create({
      data: { fromId: shared.id, toId: otherPrivate.id, type: "related_to", createdById: other.id },
    });

    const strangerA = await makeArtifact({ ownerId: stranger.id, title: "Stranger A" });
    const strangerB = await makeArtifact({ ownerId: stranger.id, title: "Stranger B" });
    await prisma.artifactRelationship.create({
      data: { fromId: strangerA.id, toId: strangerB.id, type: "related_to", createdById: stranger.id },
    });

    const res = await request(app)
      .get("/api/relationships?type=related_to")
      .set("Authorization", `Bearer ${tokenFor(caller.idpSub as string)}`)
      .expect(200);

    expect(res.body.items).toHaveLength(2);

    const mineRow = res.body.items.find((r: { from: { id: string } | null }) => r.from?.id === mine.id);
    expect(mineRow).toMatchObject({ from: { id: mine.id }, to: { id: mineTarget.id } });

    const sharedRow = res.body.items.find((r: { from: { id: string } | null }) => r.from?.id === shared.id);
    expect(sharedRow.from).toMatchObject({ id: shared.id });
    expect(sharedRow.to).toBeNull();
  });

  it("filters by ?type= when provided and returns mixed types when omitted", async () => {
    const caller = await makeActiveUser(`caller-${Math.random()}@test.local`);
    const a = await makeArtifact({ ownerId: caller.id, title: "A" });
    const b = await makeArtifact({ ownerId: caller.id, title: "B" });
    const c = await makeArtifact({ ownerId: caller.id, title: "C" });
    await prisma.artifactRelationship.create({
      data: { fromId: a.id, toId: b.id, type: "supersedes", createdById: caller.id },
    });
    await prisma.artifactRelationship.create({
      data: { fromId: a.id, toId: c.id, type: "derived_from", createdById: caller.id },
    });

    const filtered = await request(app)
      .get("/api/relationships?type=supersedes")
      .set("Authorization", `Bearer ${tokenFor(caller.idpSub as string)}`)
      .expect(200);
    expect(filtered.body.items.every((r: { type: string }) => r.type === "supersedes")).toBe(true);

    const unfiltered = await request(app)
      .get("/api/relationships")
      .set("Authorization", `Bearer ${tokenFor(caller.idpSub as string)}`)
      .expect(200);
    expect(unfiltered.body.items.some((r: { type: string }) => r.type === "supersedes")).toBe(true);
    expect(unfiltered.body.items.some((r: { type: string }) => r.type === "derived_from")).toBe(true);
  });

  it("paginates with cursor/limit, newest first", async () => {
    const caller = await makeActiveUser(`caller-${Math.random()}@test.local`);
    const anchor = await makeArtifact({ ownerId: caller.id, title: "Anchor" });
    for (let i = 0; i < 3; i++) {
      const target = await makeArtifact({ ownerId: caller.id, title: `Target ${i}` });
      await prisma.artifactRelationship.create({
        data: { fromId: anchor.id, toId: target.id, type: "related_to", createdById: caller.id },
      });
    }

    const first = await request(app)
      .get("/api/relationships?type=related_to&limit=2")
      .set("Authorization", `Bearer ${tokenFor(caller.idpSub as string)}`)
      .expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await request(app)
      .get(`/api/relationships?type=related_to&limit=2&cursor=${first.body.nextCursor}`)
      .set("Authorization", `Bearer ${tokenFor(caller.idpSub as string)}`)
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it("401s without a token", async () => {
    await request(app).get("/api/relationships").expect(401);
  });
});
