import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, textPayload, type McpTestContext } from "./support";

/** `get_enrichment_status` — owner-only read of an artifact's AI-enrichment job history
 * (docs/architecture/01 decision #46). */
describe("get_enrichment_status", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("returns the owner's enrichment run history, newest first", async () => {
    const { client, user: owner } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id });

    await ctx.prisma.artifactEnrichment.create({
      data: {
        artifactId: artifact.id,
        requestedById: owner.id,
        trigger: "publish",
        status: "completed",
        summary: "A short summary.",
        topics: ["topic-a"],
        tagsAdded: ["tag-a"],
        relationshipsProposed: [],
        completedAt: new Date(Date.now() - 60_000),
      },
    });
    await ctx.prisma.artifactEnrichment.create({
      data: { artifactId: artifact.id, requestedById: owner.id, trigger: "rerun", status: "pending" },
    });

    const result = await client.callTool({ name: "get_enrichment_status", arguments: { id: artifact.id } });

    expect(result.isError).toBeFalsy();
    const payload = textPayload(result) as {
      items: Array<{ status: string; trigger: string; summary: string | null; tagsAdded: string[] }>;
    };
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toMatchObject({ status: "pending", trigger: "rerun" });
    expect(payload.items[1]).toMatchObject({ status: "completed", trigger: "publish", summary: "A short summary.", tagsAdded: ["tag-a"] });
  });

  it("refuses a non-owner even if they can view the artifact", async () => {
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const { client } = await ctx.connectAsUser(`viewer-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

    const result = await client.callTool({ name: "get_enrichment_status", arguments: { id: artifact.id } });

    expect(result.isError).toBe(true);
  });

  it("404s (tool error) for an unknown artifact id", async () => {
    const { client } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);

    const result = await client.callTool({ name: "get_enrichment_status", arguments: { id: randomUUID() } });

    expect(result.isError).toBe(true);
  });

  it("returns an empty list for an artifact with no enrichment run yet", async () => {
    const { client, user: owner } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id });

    const result = await client.callTool({ name: "get_enrichment_status", arguments: { id: artifact.id } });

    expect(result.isError).toBeFalsy();
    const payload = textPayload(result) as { items: unknown[] };
    expect(payload.items).toHaveLength(0);
  });
});
