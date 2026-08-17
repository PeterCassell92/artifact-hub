import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, textPayload, type McpTestContext } from "./support";

/** Instant cutoff (`revoke_access`) — docs/architecture/03 §1a, owner-only, independent of expiry. */
describe("Owners can instantly revoke access to an artifact, and nobody else can", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("cuts off a viewer immediately while the owner keeps access", async () => {
    const { client: ownerClient, user: owner } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const { client: viewerClient } = await ctx.connectAsUser(`viewer-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

    const before = await viewerClient.callTool({ name: "get_artifact", arguments: { id: artifact.id } });
    expect(before.isError).toBeFalsy();

    const revoke = await ownerClient.callTool({ name: "revoke_access", arguments: { id: artifact.id } });
    expect(revoke.isError).toBeFalsy();
    const payload = textPayload(revoke) as { ok: boolean; revokedAt: string };
    expect(payload.ok).toBe(true);

    const after = await viewerClient.callTool({ name: "get_artifact", arguments: { id: artifact.id } });
    expect(after.isError).toBe(true);

    const ownerStill = await ownerClient.callTool({ name: "get_artifact", arguments: { id: artifact.id } });
    expect(ownerStill.isError).toBeFalsy();
  });

  it("refuses a non-owner", async () => {
    const { client } = await ctx.connectAsUser(`other-${randomUUID()}@test.local`);
    const owner = await ctx.makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

    const result = await client.callTool({ name: "revoke_access", arguments: { id: artifact.id } });
    expect(result.isError).toBe(true);
  });

  it("set_access_policy clears a previous revoke", async () => {
    const { client, user: owner } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const artifact = await ctx.makeArtifact({ ownerId: owner.id, audienceType: "public_authenticated" });

    await client.callTool({ name: "revoke_access", arguments: { id: artifact.id } });

    const update = await client.callTool({
      name: "set_access_policy",
      arguments: { id: artifact.id, audience: { type: "public_authenticated" }, expiry: "never" },
    });
    expect(update.isError).toBeFalsy();

    const { client: viewerClient } = await ctx.connectAsUser(`viewer-${randomUUID()}@test.local`);
    const after = await viewerClient.callTool({ name: "get_artifact", arguments: { id: artifact.id } });
    expect(after.isError).toBeFalsy();
  });
});
