import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, type McpTestContext } from "./support";

/** What an agent sees when it asks the server what it can do (`tools/list`) — docs/architecture/05 §4. */
describe("Agents can discover the v1 tool surface, and only that surface", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("lists exactly the 9 v1 tools — no admin tools are ever registered (R3)", async () => {
    const { client } = await ctx.connectAsUser(`user-${randomUUID()}@test.local`);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "comment_on_artifact",
        "create_share_link",
        "get_artifact",
        "get_user_details",
        "list_artifacts",
        "list_groups",
        "list_shared_with_me",
        "publish_artifact",
        "set_access_policy",
      ].sort(),
    );
  });
});
