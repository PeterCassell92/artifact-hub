import type { PrismaClient } from "@prisma/client";
import { startTestDatabase, type TestDatabase } from "../test-support/testDatabase";

describe("artifactRecipients", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let resolvePolicyRecipients: typeof import("./artifactRecipients").resolvePolicyRecipients;
  let buildPublishNotificationEvents: typeof import("./artifactRecipients").buildPublishNotificationEvents;
  let buildNewAccessOutboxEvents: typeof import("./artifactRecipients").buildNewAccessOutboxEvents;
  let buildAccessRevokedOutboxEvents: typeof import("./artifactRecipients").buildAccessRevokedOutboxEvents;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = db.prisma;
    ({
      resolvePolicyRecipients,
      buildPublishNotificationEvents,
      buildNewAccessOutboxEvents,
      buildAccessRevokedOutboxEvents,
    } = await import("./artifactRecipients"));
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  async function makeUser(status: "active" | "invited" | "disabled" = "active") {
    return prisma.user.create({
      data: { email: `user-${Math.random()}@test.local`, name: "Test User", idpSub: `idp|${Math.random()}`, status },
    });
  }

  async function makeGroup() {
    return prisma.group.create({ data: { name: `group-${Math.random()}` } });
  }

  describe("resolvePolicyRecipients", () => {
    it("public_authenticated resolves to every active user, excluding invited/disabled", async () => {
      const active1 = await makeUser("active");
      const active2 = await makeUser("active");
      await makeUser("invited");
      await makeUser("disabled");

      const recipients = await resolvePolicyRecipients({
        audienceType: "public_authenticated",
        allowedUserIds: [],
        allowedGroupIds: [],
      });
      const ids = recipients.map((r) => r.id);

      expect(ids).toEqual(expect.arrayContaining([active1.id, active2.id]));
    });

    it("specific_users resolves only the listed active users", async () => {
      const included = await makeUser("active");
      const excluded = await makeUser("active");
      const invitedButListed = await makeUser("invited");

      const recipients = await resolvePolicyRecipients({
        audienceType: "specific_users",
        allowedUserIds: [included.id, invitedButListed.id],
        allowedGroupIds: [],
      });

      expect(recipients.map((r) => r.id)).toEqual([included.id]);
      expect(recipients.map((r) => r.id)).not.toContain(excluded.id);
    });

    it("user_groups resolves active members of the listed groups, deduped across multiple groups", async () => {
      const group1 = await makeGroup();
      const group2 = await makeGroup();
      const memberOfBoth = await makeUser("active");
      const memberOfOne = await makeUser("active");
      const notAMember = await makeUser("active");

      await prisma.groupMembership.create({ data: { userId: memberOfBoth.id, groupId: group1.id } });
      await prisma.groupMembership.create({ data: { userId: memberOfBoth.id, groupId: group2.id } });
      await prisma.groupMembership.create({ data: { userId: memberOfOne.id, groupId: group1.id } });

      const recipients = await resolvePolicyRecipients({
        audienceType: "user_groups",
        allowedUserIds: [],
        allowedGroupIds: [group1.id, group2.id],
      });
      const ids = recipients.map((r) => r.id);

      expect(ids.filter((id) => id === memberOfBoth.id)).toHaveLength(1);
      expect(ids).toContain(memberOfOne.id);
      expect(ids).not.toContain(notAMember.id);
    });
  });

  describe("buildPublishNotificationEvents", () => {
    it("enqueues one artifact.new_access event per resolved recipient, excluding the owner", async () => {
      const owner = await makeUser("active");
      const recipient = await makeUser("active");

      const events = await buildPublishNotificationEvents("artifact-1", owner.id, {
        audienceType: "specific_users",
        allowedUserIds: [owner.id, recipient.id],
        allowedGroupIds: [],
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "artifact.new_access",
        payload: { artifactId: "artifact-1", recipientUserId: recipient.id },
      });
    });
  });

  describe("buildNewAccessOutboxEvents", () => {
    it("narrowing the audience enqueues nothing", async () => {
      const owner = await makeUser("active");
      const a = await makeUser("active");
      const b = await makeUser("active");

      const events = await buildNewAccessOutboxEvents(
        { id: "artifact-2", ownerId: owner.id },
        { audienceType: "specific_users", allowedUserIds: [a.id, b.id], allowedGroupIds: [] },
        { audienceType: "specific_users", allowedUserIds: [a.id], allowedGroupIds: [] },
      );

      expect(events).toEqual([]);
    });

    it("widening the audience enqueues exactly one event, only for the newly-added user", async () => {
      const owner = await makeUser("active");
      const alreadyShared = await makeUser("active");
      const newlyAdded = await makeUser("active");

      const events = await buildNewAccessOutboxEvents(
        { id: "artifact-3", ownerId: owner.id },
        { audienceType: "specific_users", allowedUserIds: [alreadyShared.id], allowedGroupIds: [] },
        { audienceType: "specific_users", allowedUserIds: [alreadyShared.id, newlyAdded.id], allowedGroupIds: [] },
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({ artifactId: "artifact-3", recipientUserId: newlyAdded.id });
    });

    it("never includes the owner even under public_authenticated", async () => {
      const owner = await makeUser("active");

      const events = await buildNewAccessOutboxEvents(
        { id: "artifact-4", ownerId: owner.id },
        { audienceType: "specific_users", allowedUserIds: [], allowedGroupIds: [] },
        { audienceType: "public_authenticated", allowedUserIds: [], allowedGroupIds: [] },
      );

      expect(events.some((e) => e.payload.recipientUserId === owner.id)).toBe(false);
    });
  });

  describe("buildAccessRevokedOutboxEvents", () => {
    it("enqueues one artifact.access_revoked event per recipient under the current policy, excluding the owner", async () => {
      const owner = await makeUser("active");
      const recipient = await makeUser("active");

      const events = await buildAccessRevokedOutboxEvents(
        { id: "artifact-5", ownerId: owner.id },
        { audienceType: "specific_users", allowedUserIds: [owner.id, recipient.id], allowedGroupIds: [] },
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "artifact.access_revoked",
        payload: { artifactId: "artifact-5", recipientUserId: recipient.id },
      });
    });
  });
});
