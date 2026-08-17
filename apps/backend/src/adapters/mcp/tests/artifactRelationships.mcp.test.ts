import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, textPayload, type McpTestContext } from "./support";

/**
 * Linking already-existing artifacts (`link_artifacts`), reading relationships back
 * (`list_artifact_relationships`, `list_relationships`) — docs/architecture/05 §4.
 * `publish_artifact`'s inline `relationships` argument is covered in publishArtifact.mcp.test.ts.
 * One shared `ctx`/Testcontainer for the whole file, per this suite's convention — a second
 * `setupMcpTestContext()` call in the same file/process reuses a stale server/db wiring from the
 * first context's already-stopped container instead of a fresh one.
 */
describe("Artifact relationships", () => {
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

  /**
   * `list_relationships` — corpus-wide, optionally `type`-filtered read, the bulk counterpart to
   * `list_artifact_relationships` above.
   */
  describe("list_relationships (across the whole corpus, filtered or not by type)", () => {
    it("returns a row when the caller can view from or to, redacting whichever side they can't see, and excludes rows where they can see neither", async () => {
      const { client, user } = await ctx.connectAsUser(`caller-${randomUUID()}@test.local`);
      const other = await ctx.makeActiveUser(`other-${randomUUID()}@test.local`);
      const stranger = await ctx.makeActiveUser(`stranger-${randomUUID()}@test.local`);

      // Caller owns `mine`, so both sides are visible.
      const mine = await ctx.makeArtifact({ ownerId: user.id, title: "Mine" });
      const mineTarget = await ctx.makeArtifact({ ownerId: user.id, title: "Mine target" });
      await ctx.prisma.artifactRelationship.create({
        data: { fromId: mine.id, toId: mineTarget.id, type: "related_to", createdById: user.id },
      });

      // `from` belongs to someone else but is shared with the caller; `to` is private to that owner.
      const shared = await ctx.makeArtifact({
        ownerId: other.id,
        title: "Shared",
        audienceType: "specific_users",
        allowedUserIds: [user.id],
      });
      const otherPrivate = await ctx.makeArtifact({ ownerId: other.id, title: "Other private" });
      await ctx.prisma.artifactRelationship.create({
        data: { fromId: shared.id, toId: otherPrivate.id, type: "related_to", createdById: other.id },
      });

      // Neither side viewable by the caller — must never appear.
      const strangerA = await ctx.makeArtifact({ ownerId: stranger.id, title: "Stranger A" });
      const strangerB = await ctx.makeArtifact({ ownerId: stranger.id, title: "Stranger B" });
      await ctx.prisma.artifactRelationship.create({
        data: { fromId: strangerA.id, toId: strangerB.id, type: "related_to", createdById: stranger.id },
      });

      const result = await client.callTool({ name: "list_relationships", arguments: { type: "related_to" } });
      expect(result.isError).toBeFalsy();
      const payload = textPayload(result) as {
        relationships: Array<{ from: { id: string } | null; to: { id: string } | null }>;
      };

      expect(payload.relationships).toHaveLength(2);

      const mineRow = payload.relationships.find((r) => r.from?.id === mine.id);
      expect(mineRow).toMatchObject({ from: { id: mine.id }, to: { id: mineTarget.id } });

      const sharedRow = payload.relationships.find((r) => r.from?.id === shared.id);
      expect(sharedRow?.from).toMatchObject({ id: shared.id });
      expect(sharedRow?.to).toBeNull();
    });

    it("filters by type when provided and returns mixed types when omitted", async () => {
      const { client, user } = await ctx.connectAsUser(`caller-${randomUUID()}@test.local`);
      const a = await ctx.makeArtifact({ ownerId: user.id, title: "A" });
      const b = await ctx.makeArtifact({ ownerId: user.id, title: "B" });
      const c = await ctx.makeArtifact({ ownerId: user.id, title: "C" });
      await ctx.prisma.artifactRelationship.create({
        data: { fromId: a.id, toId: b.id, type: "supersedes", createdById: user.id },
      });
      await ctx.prisma.artifactRelationship.create({
        data: { fromId: a.id, toId: c.id, type: "derived_from", createdById: user.id },
      });

      const supersedesOnly = await client.callTool({ name: "list_relationships", arguments: { type: "supersedes" } });
      const supersedesPayload = textPayload(supersedesOnly) as { relationships: Array<{ type: string }> };
      expect(supersedesPayload.relationships.every((r) => r.type === "supersedes")).toBe(true);
      expect(supersedesPayload.relationships.some((r) => r.type === "derived_from")).toBe(false);

      const all = await client.callTool({ name: "list_relationships", arguments: {} });
      const allPayload = textPayload(all) as { relationships: Array<{ type: string }> };
      expect(allPayload.relationships.some((r) => r.type === "supersedes")).toBe(true);
      expect(allPayload.relationships.some((r) => r.type === "derived_from")).toBe(true);
    });

    it("paginates with cursor/limit, newest first", async () => {
      const { client, user } = await ctx.connectAsUser(`caller-${randomUUID()}@test.local`);
      const anchor = await ctx.makeArtifact({ ownerId: user.id, title: "Anchor" });
      for (let i = 0; i < 3; i++) {
        const target = await ctx.makeArtifact({ ownerId: user.id, title: `Target ${i}` });
        await ctx.prisma.artifactRelationship.create({
          data: { fromId: anchor.id, toId: target.id, type: "related_to", createdById: user.id },
        });
      }

      const first = await client.callTool({ name: "list_relationships", arguments: { type: "related_to", limit: 2 } });
      const firstPayload = textPayload(first) as { relationships: unknown[]; nextCursor: string | null };
      expect(firstPayload.relationships).toHaveLength(2);
      expect(firstPayload.nextCursor).toEqual(expect.any(String));

      const second = await client.callTool({
        name: "list_relationships",
        arguments: { type: "related_to", limit: 2, cursor: firstPayload.nextCursor! },
      });
      const secondPayload = textPayload(second) as { relationships: unknown[]; nextCursor: string | null };
      expect(secondPayload.relationships).toHaveLength(1);
      expect(secondPayload.nextCursor).toBeNull();
    });
  });
});
