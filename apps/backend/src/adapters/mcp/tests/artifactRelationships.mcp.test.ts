import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, textPayload, type McpTestContext } from "./support";

/**
 * Linking already-existing artifacts (`link_artifacts`) and reading relationships back
 * (`list_artifact_relationships`) — docs/architecture/05 §4. `publish_artifact`'s inline
 * `relationships` argument is covered in publishArtifact.mcp.test.ts.
 */
describe("Agents can link artifacts they own to ones they can view, and read relationships back", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("link_artifacts creates a relationship for the owner linking to a viewable target", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const from = await ctx.makeArtifact({ ownerId: user.id });
    const to = await ctx.makeArtifact({ ownerId: user.id });

    const result = await client.callTool({
      name: "link_artifacts",
      arguments: { fromId: from.id, toId: to.id, type: "supersedes" },
    });

    expect(result.isError).toBeFalsy();
    const payload = textPayload(result) as { relationshipId: string; createdAt: string };
    expect(payload.relationshipId).toEqual(expect.any(String));

    const stored = await ctx.prisma.artifactRelationship.findMany({ where: { fromId: from.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ toId: to.id, type: "supersedes", createdById: user.id });
  });

  it("link_artifacts refuses a caller who doesn't own fromId", async () => {
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const { client } = await ctx.connectAsUser(`outsider-${randomUUID()}@test.local`);
    const from = await ctx.makeArtifact({ ownerId: owner.id });
    const to = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

    const result = await client.callTool({
      name: "link_artifacts",
      arguments: { fromId: from.id, toId: to.id, type: "related_to" },
    });
    expect(result.isError).toBe(true);
  });

  it("link_artifacts refuses when toId is not viewable by the caller", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const from = await ctx.makeArtifact({ ownerId: user.id });
    const other = await ctx.makeActiveUser(`other-${randomUUID()}@test.local`);
    const secret = await ctx.makeArtifact({ ownerId: other.id, audienceType: "specific_users" });

    const result = await client.callTool({
      name: "link_artifacts",
      arguments: { fromId: from.id, toId: secret.id, type: "related_to" },
    });
    expect(result.isError).toBe(true);
  });

  it("list_artifact_relationships returns both directions, redacting the far side when it isn't viewable", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const visible = await ctx.makeArtifact({ ownerId: user.id, title: "Visible related" });
    const other = await ctx.makeActiveUser(`other-${randomUUID()}@test.local`);
    const hidden = await ctx.makeArtifact({ ownerId: other.id, audienceType: "specific_users" });

    const artifact = await ctx.makeArtifact({ ownerId: user.id, title: "Main artifact" });
    await ctx.prisma.artifactRelationship.create({
      data: { fromId: artifact.id, toId: visible.id, type: "related_to", createdById: user.id },
    });
    // Link the other direction from a hidden artifact the caller can't view — its owner still
    // can, but that's not who's calling here; it must NOT be silently dropped, just redacted.
    await ctx.prisma.artifactRelationship.create({
      data: { fromId: hidden.id, toId: artifact.id, type: "related_to", createdById: other.id },
    });

    const result = await client.callTool({ name: "list_artifact_relationships", arguments: { id: artifact.id } });
    expect(result.isError).toBeFalsy();
    const payload = textPayload(result) as {
      relationships: Array<{ direction: string; otherArtifact: { id: string } | null }>;
    };
    expect(payload.relationships).toHaveLength(2);

    const outgoing = payload.relationships.find((r) => r.direction === "outgoing");
    expect(outgoing?.otherArtifact).toMatchObject({ id: visible.id });

    const incoming = payload.relationships.find((r) => r.direction === "incoming");
    expect(incoming?.otherArtifact).toBeNull();
  });

  it("list_artifact_relationships denies a caller who cannot view the artifact itself", async () => {
    const { client } = await ctx.connectAsUser(`outsider-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "specific_users" });

    const result = await client.callTool({ name: "list_artifact_relationships", arguments: { id: artifact.id } });
    expect(result.isError).toBe(true);
  });

  it("unlink_artifacts removes a relationship for the owner of its fromId", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const from = await ctx.makeArtifact({ ownerId: user.id });
    const to = await ctx.makeArtifact({ ownerId: user.id });
    const relationship = await ctx.prisma.artifactRelationship.create({
      data: { fromId: from.id, toId: to.id, type: "related_to", createdById: user.id },
    });

    const result = await client.callTool({
      name: "unlink_artifacts",
      arguments: { relationshipId: relationship.id },
    });

    expect(result.isError).toBeFalsy();
    const stored = await ctx.prisma.artifactRelationship.findUnique({ where: { id: relationship.id } });
    expect(stored).toBeNull();
  });

  it("unlink_artifacts refuses a caller who doesn't own the relationship's fromId", async () => {
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const { client } = await ctx.connectAsUser(`outsider-${randomUUID()}@test.local`);
    const from = await ctx.makeArtifact({ ownerId: owner.id });
    const to = await ctx.makeArtifact({ ownerId: owner.id });
    const relationship = await ctx.prisma.artifactRelationship.create({
      data: { fromId: from.id, toId: to.id, type: "related_to", createdById: owner.id },
    });

    const result = await client.callTool({
      name: "unlink_artifacts",
      arguments: { relationshipId: relationship.id },
    });

    expect(result.isError).toBe(true);
    const stored = await ctx.prisma.artifactRelationship.findUnique({ where: { id: relationship.id } });
    expect(stored).not.toBeNull();
  });

  it("unlink_artifacts refuses an unknown relationshipId", async () => {
    const { client } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);

    const result = await client.callTool({
      name: "unlink_artifacts",
      arguments: { relationshipId: randomUUID() },
    });

    expect(result.isError).toBe(true);
  });
});
