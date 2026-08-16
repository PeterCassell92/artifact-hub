import { randomUUID } from "node:crypto";
import { contentBlocks, setupMcpTestContext, teardownMcpTestContext, textPayload, type McpTestContext } from "./support";

/**
 * Discovery: "what have I published" (`list_artifacts`) and "what's been shared with me"
 * (`list_shared_with_me`) — docs/architecture/05 §4. This suite shares one database across tests
 * (no per-test reset, same as every *.int.test.ts file), so earlier tests' artifacts are still
 * visible later — assertions key off a unique marker per test rather than raw counts/array
 * equality, so they hold regardless of what else exists in the database.
 */
describe("Users can list their own artifacts and see what's been shared with them", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("list_artifacts returns only the caller's own artifacts, as JSON and a markdown table", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const other = await ctx.makeActiveUser(`other-${randomUUID()}@test.local`);
    await ctx.makeArtifact({ ownerId: user.id, title: "Mine" });
    await ctx.makeArtifact({ ownerId: other.id, title: "Not mine" });

    const result = await client.callTool({ name: "list_artifacts", arguments: {} });
    expect(result.isError).toBeFalsy();

    const table = contentBlocks(result)[0]!.text!;
    expect(table).toContain("Mine");
    expect(table).not.toContain("Not mine");

    const payload = textPayload(result) as { items: Array<{ title: string }> };
    expect(payload.items.map((a) => a.title)).toEqual(["Mine"]);
  });

  it("list_shared_with_me returns every matching row in JSON but caps the markdown table at 10", async () => {
    const { client } = await ctx.connectAsUser(`viewer-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const marker = randomUUID();
    const createdIds: string[] = [];
    for (let i = 0; i < 12; i++) {
      const artifact = await ctx.makeArtifact({
        ownerId: owner.id,
        title: `${marker} ${i}`,
        audienceType: "public_authenticated",
      });
      createdIds.push(artifact.id);
    }

    const result = await client.callTool({ name: "list_shared_with_me", arguments: {} });
    const payload = textPayload(result) as { items: Array<{ id: string }> };
    const returnedIds = new Set(payload.items.map((a) => a.id));
    expect(createdIds.every((id) => returnedIds.has(id))).toBe(true);

    const table = contentBlocks(result)[0]!.text!;
    const rowCount = table.split("\n").filter((line) => /^\|\s*\d+\s*\|/.test(line)).length;
    expect(rowCount).toBe(10);
  });

  it("list_shared_with_me excludes the caller's own artifacts", async () => {
    const { client, user } = await ctx.connectAsUser(`viewer-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const marker = randomUUID();
    await ctx.makeArtifact({ ownerId: user.id, title: `${marker} own`, audienceType: "public_authenticated" });
    const theirs = await ctx.makeArtifact({
      ownerId: owner.id,
      title: `${marker} theirs`,
      audienceType: "public_authenticated",
    });

    const result = await client.callTool({ name: "list_shared_with_me", arguments: {} });
    const payload = textPayload(result) as { items: Array<{ id: string; title: string }> };
    expect(payload.items.map((a) => a.id)).toContain(theirs.id);
    expect(payload.items.some((a) => a.title === `${marker} own`)).toBe(false);
  });

  it("list_shared_with_me's sinceHours excludes artifacts published before the window", async () => {
    const { client } = await ctx.connectAsUser(`viewer-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const marker = randomUUID();

    const old = await ctx.makeArtifact({
      ownerId: owner.id,
      title: `${marker} old`,
      audienceType: "public_authenticated",
    });
    await ctx.prisma.artifact.update({
      where: { id: old.id },
      data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    const recent = await ctx.makeArtifact({
      ownerId: owner.id,
      title: `${marker} recent`,
      audienceType: "public_authenticated",
    });

    const result = await client.callTool({ name: "list_shared_with_me", arguments: { sinceHours: 1 } });
    const payload = textPayload(result) as { items: Array<{ id: string }> };
    const ids = payload.items.map((a) => a.id);
    expect(ids).toContain(recent.id);
    expect(ids).not.toContain(old.id);
  });
});
