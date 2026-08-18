import { randomUUID } from "node:crypto";
import { setupMcpTestContext, teardownMcpTestContext, textPayload, type McpTestContext } from "./support";

/**
 * Publishing (docs/architecture/01 decision #44): the two-call `publish_artifact` flow — start
 * (create the artifact + a presigned upload URL), agent PUTs bytes straight to storage out of
 * band, then finish (verify the upload landed, record size). File bytes never transit a tool call.
 */
describe("Agents can publish a new artifact without ever sending its bytes through a tool call", () => {
  let ctx: McpTestContext;

  beforeAll(async () => {
    ctx = await setupMcpTestContext();
  }, 60_000);

  afterAll(async () => {
    await teardownMcpTestContext(ctx);
  });

  it("starting a publish creates a pending artifact and returns a presigned upload URL", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);

    const result = await client.callTool({
      name: "publish_artifact",
      arguments: {
        title: "Test diagram",
        fileName: "diagram.mmd",
        contentType: "text/x-mermaid",
        audience: { type: "public_authenticated" },
        expiry: "7d",
      },
    });

    expect(result.isError).toBeFalsy();
    const payload = textPayload(result) as {
      artifactId: string;
      resourceUri: string;
      uploadUrl: string;
      webUploadUrl: string;
      bytesRef: string;
    };
    expect(payload.resourceUri).toBe(`artifact://${payload.artifactId}`);
    expect(payload.bytesRef).toBe(payload.artifactId);
    expect(payload.uploadUrl).toMatch(/^http/);
    // Browser fallback for hosts whose model has no HTTP tool (decision #47) — id-only SPA link.
    expect(new URL(payload.webUploadUrl).pathname).toBe(`/artifacts/${payload.artifactId}/complete-upload`);

    const stored = await ctx.prisma.artifact.findUnique({ where: { id: payload.artifactId } });
    expect(stored).toMatchObject({ ownerId: user.id, title: "Test diagram", audienceType: "public_authenticated" });
    expect(Number(stored!.sizeBytes)).toBe(0);
  });

  it("refuses a call that supplies neither a full start payload nor bytesRef", async () => {
    const { client } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const result = await client.callTool({ name: "publish_artifact", arguments: { title: "Incomplete" } });
    expect(result.isError).toBe(true);
  });

  it("advertises its real input fields in tools/list, not an empty schema", async () => {
    const { client } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "publish_artifact")!;
    const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(["title", "fileName", "contentType", "audience", "expiry", "bytesRef"]),
    );
  });

  it("refuses to start a publish naming an unknown user email in the audience", async () => {
    const { client } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const result = await client.callTool({
      name: "publish_artifact",
      arguments: {
        title: "T",
        fileName: "f.txt",
        contentType: "text/plain",
        audience: { type: "specific_users", userEmails: ["nobody@test.local"] },
        expiry: "never",
      },
    });
    expect(result.isError).toBe(true);
  });

  it("refuses to finish a publish before the file has actually landed in storage", async () => {
    const { client } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const start = await client.callTool({
      name: "publish_artifact",
      arguments: {
        title: "T",
        fileName: "f.txt",
        contentType: "text/plain",
        audience: { type: "public_authenticated" },
        expiry: "never",
      },
    });
    const { artifactId } = textPayload(start) as { artifactId: string };

    const finish = await client.callTool({ name: "publish_artifact", arguments: { bytesRef: artifactId } });
    expect(finish.isError).toBe(true);
  });

  it("refuses to finish a publish someone else started", async () => {
    const { client: ownerClient } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const { client: otherClient } = await ctx.connectAsUser(`other-${randomUUID()}@test.local`);

    const start = await ownerClient.callTool({
      name: "publish_artifact",
      arguments: {
        title: "T",
        fileName: "f.txt",
        contentType: "text/plain",
        audience: { type: "public_authenticated" },
        expiry: "never",
      },
    });
    const { artifactId } = textPayload(start) as { artifactId: string };

    const finish = await otherClient.callTool({ name: "publish_artifact", arguments: { bytesRef: artifactId } });
    expect(finish.isError).toBe(true);
  });

  it("finishing a publish after the real upload records the file's size", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const start = await client.callTool({
      name: "publish_artifact",
      arguments: {
        title: "Real upload",
        fileName: "f.txt",
        contentType: "text/plain",
        audience: { type: "public_authenticated" },
        expiry: "never",
      },
    });
    const { artifactId, uploadUrl } = textPayload(start) as { artifactId: string; uploadUrl: string };

    const putResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: "the actual bytes",
      headers: { "Content-Type": "text/plain" },
    });
    expect(putResponse.ok).toBe(true);

    const finish = await client.callTool({ name: "publish_artifact", arguments: { bytesRef: artifactId } });
    expect(finish.isError).toBeFalsy();
    const payload = textPayload(finish) as { artifactId: string; resourceUri: string };
    expect(payload).toEqual({ artifactId, resourceUri: `artifact://${artifactId}` });

    const stored = await ctx.prisma.artifact.findUnique({ where: { id: artifactId } });
    expect(stored!.ownerId).toBe(user.id);
    expect(Number(stored!.sizeBytes)).toBe(Buffer.byteLength("the actual bytes"));
  });

  it("refuses to finish a publish whose upload exceeds the 500MB cap, and deletes the oversized object", async () => {
    const { client } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const start = await client.callTool({
      name: "publish_artifact",
      arguments: {
        title: "Too big",
        fileName: "huge.bin",
        contentType: "application/octet-stream",
        audience: { type: "public_authenticated" },
        expiry: "never",
      },
    });
    const { artifactId, uploadUrl } = textPayload(start) as { artifactId: string; uploadUrl: string };

    const oversized = Buffer.alloc(500 * 1024 * 1024 + 1);
    const putResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: oversized,
      headers: { "Content-Type": "application/octet-stream" },
    });
    expect(putResponse.ok).toBe(true);

    const finish = await client.callTool({ name: "publish_artifact", arguments: { bytesRef: artifactId } });
    expect(finish.isError).toBe(true);

    const stored = await ctx.prisma.artifact.findUnique({ where: { id: artifactId } });
    expect(Number(stored!.sizeBytes)).toBe(0);
  }, 60_000);

  it("links relationships to already-existing artifacts at publish time, reporting per-entry outcomes", async () => {
    const { client, user } = await ctx.connectAsUser(`owner-${randomUUID()}@test.local`);
    const source = await ctx.makeArtifact({ ownerId: user.id, title: "Source diagram" });

    const result = await client.callTool({
      name: "publish_artifact",
      arguments: {
        title: "Compiled output",
        fileName: "out.pdf",
        contentType: "application/pdf",
        audience: { type: "public_authenticated" },
        expiry: "never",
        relationships: [
          { toId: source.id, type: "derived_from", note: "compiled export" },
          { toId: randomUUID(), type: "related_to" }, // unknown id — reported, doesn't fail the publish
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const payload = textPayload(result) as {
      artifactId: string;
      relationshipResults: Array<{ ok: boolean; reason?: string }>;
    };
    expect(payload.relationshipResults).toHaveLength(2);
    expect(payload.relationshipResults[0]).toMatchObject({ ok: true });
    expect(payload.relationshipResults[1]).toMatchObject({ ok: false, reason: "to_not_found" });

    const stored = await ctx.prisma.artifactRelationship.findMany({ where: { fromId: payload.artifactId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ toId: source.id, type: "derived_from", note: "compiled export" });
  });

  it("can publish to a group the publisher does NOT belong to — group membership isn't required to target a group", async () => {
    const groupName = `design-team-${randomUUID()}`;
    const group = await ctx.prisma.group.create({ data: { name: groupName } });

    const { client: publisherClient } = await ctx.connectAsUser(`publisher-${randomUUID()}@test.local`);
    const { client: memberClient } = await ctx.connectAsUser(`member-${randomUUID()}@test.local`, [group.id]);
    const { client: outsiderClient } = await ctx.connectAsUser(`outsider-${randomUUID()}@test.local`);

    const start = await publisherClient.callTool({
      name: "publish_artifact",
      arguments: {
        title: "For the design team",
        fileName: "spec.txt",
        contentType: "text/plain",
        audience: { type: "user_groups", groupNames: [groupName] },
        expiry: "never",
      },
    });
    expect(start.isError).toBeFalsy();
    const { artifactId, uploadUrl } = textPayload(start) as { artifactId: string; uploadUrl: string };

    await fetch(uploadUrl, { method: "PUT", body: "spec text", headers: { "Content-Type": "text/plain" } });
    const finish = await publisherClient.callTool({ name: "publish_artifact", arguments: { bytesRef: artifactId } });
    expect(finish.isError).toBeFalsy();

    const stored = await ctx.prisma.artifact.findUnique({ where: { id: artifactId } });
    expect(stored).toMatchObject({ audienceType: "user_groups" });

    const memberRead = await memberClient.callTool({ name: "get_artifact", arguments: { id: artifactId } });
    expect(memberRead.isError).toBeFalsy();

    const outsiderRead = await outsiderClient.callTool({ name: "get_artifact", arguments: { id: artifactId } });
    expect(outsiderRead.isError).toBe(true);
  });
});
