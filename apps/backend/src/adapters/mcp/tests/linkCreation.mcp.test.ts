import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, textPayload, type McpTestContext } from "./support";

/** Minting a locator link (`create_share_link`) — docs/architecture/03 §5, requires canView, not ownership. */
describe("Anyone who can view an artifact can mint a share link for it; nobody else can", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("mints a /s/<token> link for the owner", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: user.id });

    const result = await client.callTool({ name: "create_share_link", arguments: { id: artifact.id } });
    expect(result.isError).toBeFalsy();
    const payload = textPayload(result) as { url: string };
    expect(payload.url).toContain("/s/");
  });

  it("refuses a non-owner with no view access", async () => {
    const { client } = await ctx.connectAsUser(`other-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id });

    const result = await client.callTool({ name: "create_share_link", arguments: { id: artifact.id } });
    expect(result.isError).toBe(true);
  });

  it("mints a /s/<token> link for a non-owner who can view the artifact", async () => {
    const { client } = await ctx.connectAsUser(`viewer-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

    const result = await client.callTool({ name: "create_share_link", arguments: { id: artifact.id } });
    expect(result.isError).toBeFalsy();
    const payload = textPayload(result) as { url: string };
    expect(payload.url).toContain("/s/");
  });
});
