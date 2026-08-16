import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, textPayload, type McpTestContext } from "./support";

/**
 * `list_groups` — every group in the organization, so an agent can find the exact name to pass as
 * `audience.groupNames` on `publish_artifact`/`set_access_policy`, even for a group the caller
 * isn't a member of (docs/architecture/05 §4).
 */
describe("list_groups returns every group in the org, not just the caller's own", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("includes a group the caller does not belong to", async () => {
    const { client } = await ctx.connectAsUser(`caller-${randomUUID()}@test.local`);
    const groupName = `finance-${randomUUID()}`;
    await ctx.prisma.group.create({ data: { name: groupName, description: "Finance team" } });

    const result = await client.callTool({ name: "list_groups", arguments: {} });
    expect(result.isError).toBeFalsy();

    const payload = textPayload(result) as { groups: Array<{ name: string; description: string | null }> };
    expect(payload.groups).toContainEqual({ name: groupName, description: "Finance team" });
  });

  it("returns a markdown table alongside the JSON", async () => {
    const { client } = await ctx.connectAsUser(`caller-${randomUUID()}@test.local`);
    const groupName = `ops-${randomUUID()}`;
    await ctx.prisma.group.create({ data: { name: groupName } });

    const result = await client.callTool({ name: "list_groups", arguments: {} });
    const blocks = (result as { content: Array<{ type: string; text?: string }> }).content;
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[0]!.text).toContain(groupName);
  });
});
