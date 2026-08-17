import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, type McpTestContext } from "./support";

/**
 * Leaving feedback (`comment_on_artifact`), reading it back (`list_comments`), and summarising it
 * (`summarise_artifact_reviews` prompt) — docs/architecture/05 §4/§6. The prompt injects comments
 * as content; it never calls an LLM itself (that's the client's model).
 */
describe("Users can comment on artifacts they can view, and summarise those comments via a prompt", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("comment_on_artifact adds a comment attributed to the caller when they can view it", async () => {
    const { client, user } = await ctx.connectAsUser(`viewer-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

    const result = await client.callTool({
      name: "comment_on_artifact",
      arguments: { id: artifact.id, body: "Nice work" },
    });
    expect(result.isError).toBeFalsy();

    const stored = await ctx.prisma.comment.findMany({ where: { artifactId: artifact.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ authorId: user.id, body: "Nice work" });
  });

  it("comment_on_artifact denies a caller who cannot view the artifact", async () => {
    const { client } = await ctx.connectAsUser(`outsider-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "specific_users" });

    const result = await client.callTool({
      name: "comment_on_artifact",
      arguments: { id: artifact.id, body: "Sneaky" },
    });
    expect(result.isError).toBe(true);
  });

  it("list_comments returns comments oldest-first with author name, body, and date", async () => {
    const { client, user } = await ctx.connectAsUser(`viewer-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });
    await ctx.prisma.comment.create({ data: { artifactId: artifact.id, authorId: owner.id, body: "First" } });
    await ctx.prisma.comment.create({ data: { artifactId: artifact.id, authorId: user.id, body: "Second" } });

    const result = await client.callTool({ name: "list_comments", arguments: { id: artifact.id } });
    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.text?.includes("comments"))?.text ?? "";
    const parsed = JSON.parse(text) as { comments: Array<{ body: string; authorName: string; createdAt: string }> };
    expect(parsed.comments.map((c) => c.body)).toEqual(["First", "Second"]);
  });

  it("list_comments denies a caller who cannot view the artifact", async () => {
    const { client } = await ctx.connectAsUser(`outsider-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "specific_users" });

    const result = await client.callTool({ name: "list_comments", arguments: { id: artifact.id } });
    expect(result.isError).toBe(true);
  });

  it("summarise_artifact_reviews injects the artifact's comments as prompt content", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: user.id, title: "Reviewed thing" });
    await ctx.prisma.comment.create({ data: { artifactId: artifact.id, authorId: user.id, body: "Great stuff" } });

    const result = await client.getPrompt({ name: "summarise_artifact_reviews", arguments: { artifactId: artifact.id } });
    const text = (result.messages[0]!.content as { text?: string }).text ?? "";
    expect(text).toContain("Great stuff");
    expect(text).toContain("Reviewed thing");
  });

  it("summarise_artifact_reviews refuses for an artifact the caller cannot view", async () => {
    const { client } = await ctx.connectAsUser(`outsider-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "specific_users" });

    await expect(
      client.getPrompt({ name: "summarise_artifact_reviews", arguments: { artifactId: artifact.id } }),
    ).rejects.toThrow();
  });
});
