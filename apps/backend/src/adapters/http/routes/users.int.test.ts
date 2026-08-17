import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { startTestDatabase, type TestDatabase } from "../../../test-support/testDatabase";

describe("GET /api/users", () => {
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

  it("200s for a non-admin member (unlike /api/admin/users) and lists active users, trimmed", async () => {
    const other = await prisma.user.create({
      data: { email: `other-${Math.random()}@test.local`, idpSub: `idp|${Math.random()}`, status: "active", name: "Ada" },
    });
    const member = await prisma.user.create({
      data: {
        email: `member-${Math.random()}@test.local`,
        name: "Test Member",
        idpSub: `idp|${Math.random()}`,
        status: "active",
        role: "member",
      },
    });

    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${tokenFor(member.idpSub as string)}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.arrayContaining([{ id: other.id, email: other.email, name: "Ada" }]),
    );
    // Trimmed — no role/status/groupNames leak to a non-admin caller.
    expect(Object.keys(res.body[0])).toEqual(["id", "email", "name"]);
  });

  it("excludes disabled/invited users", async () => {
    const disabled = await prisma.user.create({
      data: {
        email: `disabled-${Math.random()}@test.local`,
        name: "Test Disabled",
        idpSub: `idp|${Math.random()}`,
        status: "disabled",
      },
    });
    const member = await prisma.user.create({
      data: {
        email: `member-${Math.random()}@test.local`,
        name: "Test Member",
        idpSub: `idp|${Math.random()}`,
        status: "active",
      },
    });

    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${tokenFor(member.idpSub as string)}`)
      .expect(200);

    expect(res.body.map((u: { id: string }) => u.id)).not.toContain(disabled.id);
  });

  it("401s without a token", async () => {
    await request(app).get("/api/users").expect(401);
  });
});
