import { randomUUID } from "node:crypto";
import { contentBlocks, setupMcpTestContext, teardownMcpTestContext, type McpTestContext } from "./support";

/** Reading an artifact's content inline for reasoning (`get_artifact`) — docs/architecture/05 §4. */
describe("Agents can read small artifact content inline, gated by the same access rules as everywhere else", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("returns small text content as an embedded resource and audits an mcp view event", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: user.id, contentType: "text/plain", body: "small text body" });

    const result = await client.callTool({ name: "get_artifact", arguments: { id: artifact.id } });
    expect(result.isError).toBeFalsy();
    const block = contentBlocks(result)[0]!;
    expect(block.type).toBe("resource");
    expect(block.resource?.text).toBe("small text body");

    const events = await ctx.prisma.accessEvent.findMany({ where: { artifactId: artifact.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: "mcp", action: "view", decision: "allowed" });
  });

  it("returns a resource_link pointer instead of inlining content over the size cap", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.prisma.artifact.create({
      data: {
        ownerId: user.id,
        title: "Big",
        fileName: "big.bin",
        contentType: "application/octet-stream",
        storageKey: `artifacts/${randomUUID()}/big.bin`,
        sizeBytes: BigInt(600 * 1024),
        audienceType: "public_authenticated",
      },
    });

    const result = await client.callTool({ name: "get_artifact", arguments: { id: artifact.id } });
    expect(result.isError).toBeFalsy();
    const block = contentBlocks(result)[0]!;
    expect(block.type).toBe("resource_link");
    expect(block.uri).toBe(`artifact://${artifact.id}`);
  });

  it("denies and audits a user outside the artifact's audience", async () => {
    const { client } = await ctx.connectAsUser(`outsider-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "specific_users" });

    const result = await client.callTool({ name: "get_artifact", arguments: { id: artifact.id } });
    expect(result.isError).toBe(true);

    const events = await ctx.prisma.accessEvent.findMany({ where: { artifactId: artifact.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: "mcp", decision: "denied", denyReason: "not_in_audience" });
  });
});
