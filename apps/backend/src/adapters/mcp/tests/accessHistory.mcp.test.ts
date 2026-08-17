import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, textPayload, type McpTestContext } from "./support";

/** `get_access_history` — owner-only read of an artifact's AccessEvent audit trail (docs/models/access-event.md §6). */
describe("get_access_history", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("returns the owner's access events, newest first, including denied attempts", async () => {
    const { client, user: owner } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const viewer = await ctx.makeActiveUser(`viewer-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

    await ctx.prisma.accessEvent.create({
      data: {
        artifactId: artifact.id,
        userId: viewer.id,
        route: "ui",
        action: "view",
        decision: "allowed",
        at: new Date(Date.now() - 60_000),
      },
    });
    await ctx.prisma.accessEvent.create({
      data: {
        artifactId: artifact.id,
        userId: viewer.id,
        route: "mcp",
        action: "download",
        decision: "denied",
        denyReason: "revoked",
        at: new Date(),
      },
    });

    const result = await client.callTool({ name: "get_access_history", arguments: { id: artifact.id } });

    expect(result.isError).toBeFalsy();
    const payload = textPayload(result) as {
      accessEvents: Array<{ userId: string; userName: string; decision: string; denyReason?: string }>;
      nextCursor: string | null;
    };
    expect(payload.accessEvents).toHaveLength(2);
    expect(payload.accessEvents[0]).toMatchObject({ userId: viewer.id, decision: "denied", denyReason: "revoked" });
    expect(payload.accessEvents[1]).toMatchObject({ userId: viewer.id, userName: viewer.name, decision: "allowed" });
    expect(payload.nextCursor).toBeNull();
  });

  it("refuses a non-owner even if they can view the artifact", async () => {
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const { client } = await ctx.connectAsUser(`viewer-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

    const result = await client.callTool({ name: "get_access_history", arguments: { id: artifact.id } });

    expect(result.isError).toBe(true);
  });

  it("404s (tool error) for an unknown artifact id", async () => {
    const { client } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);

    const result = await client.callTool({ name: "get_access_history", arguments: { id: randomUUID() } });

    expect(result.isError).toBe(true);
  });

  it("paginates with cursor/limit, newest first", async () => {
    const { client, user: owner } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const viewer = await ctx.makeActiveUser(`viewer-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id });
    for (let i = 0; i < 3; i++) {
      await ctx.prisma.accessEvent.create({
        data: {
          artifactId: artifact.id,
          userId: viewer.id,
          route: "ui",
          action: "view",
          decision: "allowed",
          at: new Date(Date.now() + i * 1000),
        },
      });
    }

    const first = await client.callTool({ name: "get_access_history", arguments: { id: artifact.id, limit: 2 } });
    const firstPayload = textPayload(first) as { accessEvents: unknown[]; nextCursor: string | null };
    expect(firstPayload.accessEvents).toHaveLength(2);
    expect(firstPayload.nextCursor).toEqual(expect.any(String));

    const second = await client.callTool({
      name: "get_access_history",
      arguments: { id: artifact.id, limit: 2, cursor: firstPayload.nextCursor! },
    });
    const secondPayload = textPayload(second) as { accessEvents: unknown[]; nextCursor: string | null };
    expect(secondPayload.accessEvents).toHaveLength(1);
    expect(secondPayload.nextCursor).toBeNull();
  });
});
