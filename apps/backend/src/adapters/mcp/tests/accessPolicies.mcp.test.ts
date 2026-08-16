import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, type McpTestContext } from "./support";

/** Changing who can see an artifact (`set_access_policy`) — docs/architecture/03/05, owner-only. */
describe("Owners can change an artifact's access policy — including revoking it — and nobody else can", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("owner narrowing the audience flips a previously-allowed viewer to denied", async () => {
    const { client: ownerClient, user: owner } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const { client: viewerClient } = await ctx.connectAsUser(`viewer-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

    const before = await viewerClient.callTool({ name: "get_artifact", arguments: { id: artifact.id } });
    expect(before.isError).toBeFalsy();

    const update = await ownerClient.callTool({
      name: "set_access_policy",
      arguments: { id: artifact.id, audience: { type: "specific_users", userEmails: [owner.email] }, expiry: "never" },
    });
    expect(update.isError).toBeFalsy();

    const after = await viewerClient.callTool({ name: "get_artifact", arguments: { id: artifact.id } });
    expect(after.isError).toBe(true);
  });

  it("enforces owner-only (docs/architecture/09 §4 requirement)", async () => {
    const { client } = await ctx.connectAsUser(`other-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id });

    const result = await client.callTool({
      name: "set_access_policy",
      arguments: { id: artifact.id, audience: { type: "public_authenticated" }, expiry: "never" },
    });
    expect(result.isError).toBe(true);
  });
});
