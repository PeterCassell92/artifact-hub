import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, textPayload, type McpTestContext } from "./support";

/**
 * `get_user_details` — lets an agent discover the caller's own group names before guessing at
 * `audience.groupNames` on `publish_artifact`/`set_access_policy` (docs/architecture/05 §4).
 */
describe("get_user_details returns the caller's own identity, never anyone else's", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("returns email, name, role, and group names for the connected user", async () => {
    const email = `get_user_details-${randomUUID()}@test.local`;
    const { client, user } = await ctx.connectAsUser(email);

    const groupName = `engineering-${randomUUID()}`;
    const group = await ctx.prisma.group.create({ data: { name: groupName } });
    await ctx.prisma.groupMembership.create({ data: { userId: user.id, groupId: group.id } });
    await ctx.prisma.user.update({ where: { id: user.id }, data: { name: "Ada Lovelace" } });

    const result = await client.callTool({ name: "get_user_details", arguments: {} });
    expect(result.isError).toBeFalsy();

    const payload = textPayload(result) as {
      email: string;
      name: string | null;
      role: string;
      groupNames: string[];
    };
    expect(payload).toMatchObject({ email, name: "Ada Lovelace", role: "member" });
    expect(payload.groupNames).toContain(groupName);
  });

  it("never returns another user's info — each caller only sees their own", async () => {
    const { client: clientA } = await ctx.connectAsUser(`a-${randomUUID()}@test.local`);
    const emailB = `b-${randomUUID()}@test.local`;
    const { client: clientB } = await ctx.connectAsUser(emailB);

    const resultA = await clientA.callTool({ name: "get_user_details", arguments: {} });
    const payloadA = textPayload(resultA) as { email: string };
    expect(payloadA.email).not.toBe(emailB);

    const resultB = await clientB.callTool({ name: "get_user_details", arguments: {} });
    const payloadB = textPayload(resultB) as { email: string };
    expect(payloadB.email).toBe(emailB);
  });
});
