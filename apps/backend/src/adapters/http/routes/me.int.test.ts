import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { startTestDatabase, type TestDatabase } from "../../../test-support/testDatabase";

describe("GET /api/me", () => {
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

  it("returns the caller's profile — role, status, group names", async () => {
    const group = await prisma.group.create({ data: { name: `group-${Math.random()}` } });
    const user = await prisma.user.create({
      data: {
        email: `me-${Math.random()}@test.local`,
        idpSub: `idp|${Math.random()}`,
        name: "Ada Lovelace",
        status: "active",
        role: "admin",
        memberships: { create: { groupId: group.id } },
      },
    });

    const res = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${tokenFor(user.idpSub as string)}`)
      .expect(200);

    expect(res.body).toMatchObject({
      id: user.id,
      email: user.email,
      name: "Ada Lovelace",
      role: "admin",
      status: "active",
      groupNames: [group.name],
    });
  });

  it("401s without a token", async () => {
    await request(app).get("/api/me").expect(401);
  });
});
