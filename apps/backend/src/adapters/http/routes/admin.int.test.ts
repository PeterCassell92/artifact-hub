import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { startTestDatabase, type TestDatabase } from "../../../test-support/testDatabase";

describe("/api/admin/*", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let app: Express;
  let mintTestToken: typeof import("../../../auth/testTokens").mintTestToken;
  let getEnv: typeof import("../../../env").getEnv;

  const API_AUDIENCE = "https://api.artifact-hub.test";
  const MCP_AUDIENCE = "https://mcp.artifact-hub.test";

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

  function tokenFor(idpSub: string, audience = API_AUDIENCE) {
    return mintTestToken({ sub: idpSub, audience }, getEnv());
  }

  async function makeUser(role: "member" | "admin" = "member") {
    return prisma.user.create({
      data: {
        email: `user-${Math.random()}@test.local`,
        name: "Test User",
        idpSub: `idp|${Math.random()}`,
        status: "active",
        role,
      },
    });
  }

  describe("admin gate", () => {
    it("403s a non-admin member", async () => {
      const member = await makeUser("member");
      await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${tokenFor(member.idpSub as string)}`)
        .expect(403);
    });

    it("rejects an MCP-audience token structurally (R3) even for an admin", async () => {
      const admin = await makeUser("admin");
      await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string, MCP_AUDIENCE)}`)
        .expect(403);
    });
  });

  describe("GET /api/admin/users", () => {
    it("200s for an admin and includes group names", async () => {
      const admin = await makeUser("admin");
      const target = await makeUser("member");
      const group = await prisma.group.create({ data: { name: `g-${Math.random()}` } });
      await prisma.groupMembership.create({ data: { userId: target.id, groupId: group.id } });

      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
        .expect(200);

      expect(res.body).toContainEqual(
        expect.objectContaining({ id: target.id, groupNames: [group.name] }),
      );
    });
  });

  describe("POST /api/admin/users/:id/groups (corrective)", () => {
    it("replaces the full group set and audit-logs it", async () => {
      const admin = await makeUser("admin");
      const target = await makeUser("member");
      const oldGroup = await prisma.group.create({ data: { name: `old-${Math.random()}` } });
      const newGroup = await prisma.group.create({ data: { name: `new-${Math.random()}` } });
      await prisma.groupMembership.create({ data: { userId: target.id, groupId: oldGroup.id } });

      await request(app)
        .post(`/api/admin/users/${target.id}/groups`)
        .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
        .send({ groupIds: [newGroup.id] })
        .expect(204);

      const memberships = await prisma.groupMembership.findMany({ where: { userId: target.id } });
      expect(memberships.map((m) => m.groupId)).toEqual([newGroup.id]);

      const audit = await prisma.adminAuditLog.findMany({
        where: { targetType: "user", targetId: target.id, action: "user.group_change" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actorId: admin.id });
    });

    it("400s for an unknown groupId", async () => {
      const admin = await makeUser("admin");
      const target = await makeUser("member");

      await request(app)
        .post(`/api/admin/users/${target.id}/groups`)
        .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
        .send({ groupIds: ["00000000-0000-0000-0000-000000000000"] })
        .expect(400);
    });
  });

  describe("POST /api/admin/users/:id/role", () => {
    it("promotes a member to admin and audit-logs it", async () => {
      const admin = await makeUser("admin");
      const target = await makeUser("member");

      await request(app)
        .post(`/api/admin/users/${target.id}/role`)
        .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
        .send({ role: "admin" })
        .expect(204);

      const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(reloaded.role).toBe("admin");

      const audit = await prisma.adminAuditLog.findMany({
        where: { targetType: "user", targetId: target.id, action: "role.change" },
      });
      expect(audit).toHaveLength(1);
    });

    it("409s demoting the sole remaining active admin (lock-out guard)", async () => {
      await prisma.user.updateMany({ where: { role: "admin", status: "active" }, data: { status: "disabled" } });
      const soleAdmin = await makeUser("admin");

      await request(app)
        .post(`/api/admin/users/${soleAdmin.id}/role`)
        .set("Authorization", `Bearer ${tokenFor(soleAdmin.idpSub as string)}`)
        .send({ role: "member" })
        .expect(409);

      const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: soleAdmin.id } });
      expect(reloaded.role).toBe("admin");
    });

    it("allows demoting when another active admin remains", async () => {
      await prisma.user.updateMany({ where: { role: "admin", status: "active" }, data: { status: "disabled" } });
      const admin1 = await makeUser("admin");
      const admin2 = await makeUser("admin");

      await request(app)
        .post(`/api/admin/users/${admin2.id}/role`)
        .set("Authorization", `Bearer ${tokenFor(admin1.idpSub as string)}`)
        .send({ role: "member" })
        .expect(204);
    });

    it("409s an admin attempting to change their own role", async () => {
      const admin1 = await makeUser("admin");
      await makeUser("admin"); // second active admin so the lock-out guard isn't what blocks this

      await request(app)
        .post(`/api/admin/users/${admin1.id}/role`)
        .set("Authorization", `Bearer ${tokenFor(admin1.idpSub as string)}`)
        .send({ role: "member" })
        .expect(409);

      const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: admin1.id } });
      expect(reloaded.role).toBe("admin");
    });
  });

  describe("POST /api/admin/users/:id/disable", () => {
    it("disables a member and audit-logs it", async () => {
      const admin = await makeUser("admin");
      const target = await makeUser("member");

      await request(app)
        .post(`/api/admin/users/${target.id}/disable`)
        .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
        .expect(204);

      const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(reloaded.status).toBe("disabled");

      const audit = await prisma.adminAuditLog.findMany({
        where: { targetType: "user", targetId: target.id, action: "user.disable" },
      });
      expect(audit).toHaveLength(1);
    });

    it("409s disabling the sole remaining active admin", async () => {
      await prisma.user.updateMany({ where: { role: "admin", status: "active" }, data: { status: "disabled" } });
      const soleAdmin = await makeUser("admin");

      await request(app)
        .post(`/api/admin/users/${soleAdmin.id}/disable`)
        .set("Authorization", `Bearer ${tokenFor(soleAdmin.idpSub as string)}`)
        .expect(409);
    });

    it("409s an admin attempting to disable their own account", async () => {
      const admin1 = await makeUser("admin");
      await makeUser("admin"); // second active admin so the lock-out guard isn't what blocks this

      await request(app)
        .post(`/api/admin/users/${admin1.id}/disable`)
        .set("Authorization", `Bearer ${tokenFor(admin1.idpSub as string)}`)
        .expect(409);

      const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: admin1.id } });
      expect(reloaded.status).toBe("active");
    });
  });

  describe("GET/POST /api/admin/groups", () => {
    it("creates and lists a group", async () => {
      const admin = await makeUser("admin");
      const name = `newgroup-${Math.random()}`;

      const created = await request(app)
        .post("/api/admin/groups")
        .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
        .send({ name })
        .expect(201);
      expect(created.body).toMatchObject({ name });

      const listed = await request(app)
        .get("/api/admin/groups")
        .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
        .expect(200);
      expect(listed.body).toContainEqual(expect.objectContaining({ name }));
    });
  });
});
