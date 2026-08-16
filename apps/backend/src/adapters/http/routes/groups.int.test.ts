import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { startTestDatabase, type TestDatabase } from "../../../test-support/testDatabase";

describe("GET /api/groups", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let app: Express;
  let mintTestToken: typeof import("../../../auth/testTokens").mintTestToken;
  let getEnv: typeof import("../../../env").getEnv;

  const API_AUDIENCE = "https://api.artifact-hub.test";

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = db.prisma;

    ({ getEnv } = await import("../../../env"));
    ({ mintTestToken } = await import("../../../auth/testTokens"));
    const { createApp } = await import("../../../app");
    app = createApp();
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  function tokenFor(idpSub: string) {
    return mintTestToken({ sub: idpSub, audience: API_AUDIENCE }, getEnv());
  }

  it("200s for a non-admin member (unlike /api/admin/groups) and lists all groups", async () => {
    const group = await prisma.group.create({ data: { name: `group-${Math.random()}` } });
    const member = await prisma.user.create({
      data: { email: `member-${Math.random()}@test.local`, idpSub: `idp|${Math.random()}`, status: "active", role: "member" },
    });

    const res = await request(app)
      .get("/api/groups")
      .set("Authorization", `Bearer ${tokenFor(member.idpSub as string)}`)
      .expect(200);

    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: group.id, name: group.name })]));
  });

  it("401s without a token", async () => {
    await request(app).get("/api/groups").expect(401);
  });
});
