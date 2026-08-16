import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, type McpTestContext } from "./support";

/**
 * Downloading a file's actual bytes — the `artifact://<id>` Resource, the only byte path for an
 * MCP agent (docs/architecture/05 §5). Re-authorizes on every read, so revocation applies here too.
 */
describe("Users can download an artifact they're permitted to view, and lose access the instant it's revoked", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("returns the file's bytes (blob + mimeType) and audits an mcp download event", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: user.id, contentType: "text/plain", body: "resource bytes" });

    const result = await client.readResource({ uri: `artifact://${artifact.id}` });
    expect(result.contents).toHaveLength(1);
    const content = result.contents[0]! as { mimeType?: string; blob?: string };
    expect(content.mimeType).toBe("text/plain");
    expect(Buffer.from(content.blob!, "base64").toString("utf8")).toBe("resource bytes");

    const events = await ctx.prisma.accessEvent.findMany({ where: { artifactId: artifact.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: "mcp", action: "download", decision: "allowed" });
  });

  it("revoking access blocks the very next download attempt, even mid-session", async () => {
    const { client: ownerClient, user: owner } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const { client: viewerClient } = await ctx.connectAsUser(`viewer-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

    await expect(viewerClient.readResource({ uri: `artifact://${artifact.id}` })).resolves.toBeDefined();

    await ownerClient.callTool({
      name: "set_access_policy",
      arguments: { id: artifact.id, audience: { type: "specific_users", userEmails: [owner.email] }, expiry: "never" },
    });

    await expect(viewerClient.readResource({ uri: `artifact://${artifact.id}` })).rejects.toThrow();
  });
});
