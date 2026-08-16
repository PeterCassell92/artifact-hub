import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { startTestDatabase, type TestDatabase } from "../../../test-support/testDatabase";

describe("Invitation lifecycle (docs/architecture/02 §4)", () => {
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

  async function makeAdmin() {
    return prisma.user.create({
      data: { email: `admin-${Math.random()}@test.local`, idpSub: `idp|${Math.random()}`, status: "active", role: "admin" },
    });
  }

  async function extractRawToken(invitationId: string): Promise<string> {
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `invitation:${invitationId}` },
    });
    const payload = event.payload as { token: string };
    return payload.token;
  }

  it("create -> preview -> accept provisions the user with immutable groups, and audits both steps", async () => {
    const admin = await makeAdmin();
    const group = await prisma.group.create({ data: { name: `product-${Math.random()}` } });
    const email = `invitee-${Math.random()}@test.local`;

    const created = await request(app)
      .post("/api/admin/invitations")
      .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
      .send({ email, role: "member", groupIds: [group.id] })
      .expect(201);
    expect(created.body).toMatchObject({ email, role: "member", groupNames: [group.name], status: "pending" });

    const inviteAudit = await prisma.adminAuditLog.findMany({
      where: { targetType: "invitation", targetId: created.body.id, action: "invite.create" },
    });
    expect(inviteAudit).toHaveLength(1);
    expect(inviteAudit[0]).toMatchObject({ actorId: admin.id });

    const token = await extractRawToken(created.body.id);

    const preview = await request(app).get(`/api/invitations/${token}`).expect(200);
    expect(preview.body).toEqual({ email, role: "member", groupNames: [group.name] });

    await request(app).post("/api/invitations/accept").send({ token }).expect(204);

    const provisioned = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(provisioned.status).toBe("active");
    expect(provisioned.role).toBe("member");

    const memberships = await prisma.groupMembership.findMany({ where: { userId: provisioned.id } });
    expect(memberships.map((m) => m.groupId)).toEqual([group.id]);

    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(invitation.status).toBe("accepted");
    expect(invitation.acceptedAt).not.toBeNull();

    const acceptAudit = await prisma.adminAuditLog.findMany({
      where: { targetType: "invitation", targetId: created.body.id, action: "invitation.accept" },
    });
    expect(acceptAudit).toHaveLength(1);
    expect(acceptAudit[0]?.actorId).toBeNull();

    // Auth0 provisioning is enqueued (docs/architecture/02 §6), not called inline — the drain
    // worker links idpSub asynchronously; see workers/handlers/auth0ProvisionUser.int.test.ts.
    const provisionEvent = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `auth0-provision:${created.body.id}` },
    });
    expect(provisionEvent).toMatchObject({
      type: "auth0.provision_user",
      status: "pending",
      payload: { userId: provisioned.id, email },
    });

    // Single-use: the same token no longer previews or accepts.
    await request(app).get(`/api/invitations/${token}`).expect(404);
    await request(app).post("/api/invitations/accept").send({ token }).expect(404);
  });

  it("activates a pre-seeded (INITIAL_ADMIN_EMAILS-style) users row instead of erroring on conflict", async () => {
    const admin = await makeAdmin();
    const email = `preseeded-${Math.random()}@test.local`;
    await prisma.user.create({ data: { email, role: "admin", status: "invited" } });

    const created = await request(app)
      .post("/api/admin/invitations")
      .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
      .send({ email, role: "admin", groupIds: [] })
      .expect(201);

    const token = await extractRawToken(created.body.id);
    await request(app).post("/api/invitations/accept").send({ token }).expect(204);

    const provisioned = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(provisioned.status).toBe("active");
  });

  it("404s accepting an expired invitation", async () => {
    const admin = await makeAdmin();
    const email = `expired-${Math.random()}@test.local`;

    const created = await request(app)
      .post("/api/admin/invitations")
      .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
      .send({ email, role: "member", groupIds: [] })
      .expect(201);

    await prisma.invitation.update({
      where: { id: created.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const token = await extractRawToken(created.body.id);
    await request(app).get(`/api/invitations/${token}`).expect(404);
    await request(app).post("/api/invitations/accept").send({ token }).expect(404);
  });

  it("404s a garbage/unknown token", async () => {
    await request(app).get("/api/invitations/not-a-real-token").expect(404);
    await request(app).post("/api/invitations/accept").send({ token: "not-a-real-token" }).expect(404);
  });

  it("400s creating an invitation with an unknown groupId", async () => {
    const admin = await makeAdmin();
    await request(app)
      .post("/api/admin/invitations")
      .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
      .send({ email: "x@test.local", role: "member", groupIds: ["00000000-0000-0000-0000-000000000000"] })
      .expect(400);
  });

  it("GET /api/admin/invitations lists invitations with inviter + group names", async () => {
    const admin = await makeAdmin();
    const group = await prisma.group.create({ data: { name: `eng-${Math.random()}` } });
    const email = `list-target-${Math.random()}@test.local`;

    await request(app)
      .post("/api/admin/invitations")
      .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
      .send({ email, role: "member", groupIds: [group.id] })
      .expect(201);

    const res = await request(app)
      .get("/api/admin/invitations")
      .set("Authorization", `Bearer ${tokenFor(admin.idpSub as string)}`)
      .expect(200);

    expect(res.body).toContainEqual(
      expect.objectContaining({ email, groupNames: [group.name], invitedByName: admin.name }),
    );
  });
});
