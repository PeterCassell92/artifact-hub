import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { startTestDatabase, type TestDatabase } from "../../test-support/testDatabase";

/**
 * MCP HTTP black-box layer (docs/architecture/09 §4): hits the real `/mcp` endpoint over
 * Streamable HTTP with a minted, audience-bound bearer token — the real RS validation path
 * (signature/issuer/audience/status, R1/R2/R4), the real Express app, the real JSON-RPC framing.
 * Only the token *signer* is a test key (never trusted in production).
 */
describe("POST /mcp (HTTP black-box)", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let app: Express;
  let mintTestToken: typeof import("../../auth/testTokens").mintTestToken;
  let getEnv: typeof import("../../env").getEnv;
  // tokenValidation.ts transitively imports db.ts (eager PrismaClient) — must stay a dynamic
  // import loaded only after startTestDatabase() sets DATABASE_URL, same reason as createApp below.
  let getMcpProtectedResourceMetadataUrl: typeof import("../../auth/tokenValidation").getMcpProtectedResourceMetadataUrl;

  const MCP_AUDIENCE = "https://mcp.artifact-hub.test";
  const API_AUDIENCE = "https://api.artifact-hub.test";

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = db.prisma;

    ({ getEnv } = await import("../../env"));
    ({ mintTestToken } = await import("../../auth/testTokens"));
    ({ getMcpProtectedResourceMetadataUrl } = await import("../../auth/tokenValidation"));
    const { createApp } = await import("../../app");
    app = createApp();
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  async function makeActiveUser(email: string) {
    return prisma.user.create({ data: { email, name: "Test User", idpSub: `idp|${email}`, status: "active" } });
  }

  function tokenFor(idpSub: string, audience = MCP_AUDIENCE) {
    return mintTestToken({ sub: idpSub, audience }, getEnv());
  }

  function rpcRequest(token: string, body: Record<string, unknown>) {
    return request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send(body);
  }

  /** Streamable HTTP responds as SSE (`event: message\ndata: {...}`) — unwrap to the JSON-RPC envelope. */
  function parseSseBody(text: string): { jsonrpc: string; id: unknown; result?: unknown; error?: unknown } {
    const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
    expect(dataLine).toBeDefined();
    return JSON.parse(dataLine!.slice("data: ".length));
  }

  it("401s with no bearer token, carrying WWW-Authenticate pointing at our Protected Resource Metadata", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(401);

    const expectedUrl = getMcpProtectedResourceMetadataUrl(getEnv());
    expect(res.headers["www-authenticate"]).toContain(`resource_metadata="${expectedUrl}"`);
  });

  it("does not set WWW-Authenticate on /api/* denials — PRM discovery is MCP-only", async () => {
    const res = await request(app).get("/api/artifacts").expect(401);
    expect(res.headers["www-authenticate"]).toBeUndefined();
  });

  describe("GET /.well-known/oauth-protected-resource (RFC 9728)", () => {
    it("serves Protected Resource Metadata describing /mcp and Auth0 as the authorization server", async () => {
      const env = getEnv();
      const url = new URL(getMcpProtectedResourceMetadataUrl(env));

      const res = await request(app).get(url.pathname).expect(200);

      expect(res.body).toMatchObject({
        resource: env.AUTH0_MCP_AUDIENCE,
        authorization_servers: [`https://${env.AUTH0_DOMAIN}/`],
      });
    });

    it("is also reachable at the bare well-known path as a defensive alias", async () => {
      await request(app).get("/.well-known/oauth-protected-resource").expect(200);
    });
  });

  it("403s a valid token minted for the wrong audience (API instead of MCP)", async () => {
    const user = await makeActiveUser(`user-${randomUUID()}@test.local`);
    await rpcRequest(tokenFor(user.idpSub as string, API_AUDIENCE), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }).expect(403);
  });

  it("403s a disabled user's token", async () => {
    const user = await prisma.user.create({
      data: {
        email: `disabled-${randomUUID()}@test.local`,
        name: "Test Disabled",
        idpSub: `idp|disabled-${randomUUID()}`,
        status: "disabled",
      },
    });
    await rpcRequest(tokenFor(user.idpSub as string), { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }).expect(
      403,
    );
  });

  it("lists tools over real JSON-RPC/Streamable HTTP framing, with no admin tools", async () => {
    const user = await makeActiveUser(`user-${randomUUID()}@test.local`);
    const res = await rpcRequest(tokenFor(user.idpSub as string), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }).expect(200);

    const envelope = parseSseBody(res.text);
    expect(envelope.jsonrpc).toBe("2.0");
    const tools = (envelope.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "comment_on_artifact",
        "create_share_link",
        "get_access_history",
        "get_artifact",
        "get_user_details",
        "link_artifacts",
        "list_artifact_relationships",
        "list_artifacts",
        "list_comments",
        "list_groups",
        "list_relationships",
        "list_shared_with_me",
        "publish_artifact",
        "revoke_access",
        "set_access_policy",
        "unlink_artifacts",
      ].sort(),
    );
  });

  it("calls a tool end to end and the result is metadata-only JSON, never raw file bytes", async () => {
    const owner = await makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await prisma.artifact.create({
      data: {
        ownerId: owner.id,
        title: "HTTP path artifact",
        fileName: "f.txt",
        contentType: "text/plain",
        storageKey: `artifacts/${randomUUID()}/f.txt`,
        sizeBytes: BigInt(5),
        audienceType: "public_authenticated",
      },
    });

    const res = await rpcRequest(tokenFor(owner.idpSub as string), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_artifacts", arguments: {} },
    }).expect(200);

    const envelope = parseSseBody(res.text);
    const result = envelope.result as { content: Array<{ type: string; text?: string }> };
    const jsonBlock = result.content.at(-1)!;
    expect(jsonBlock.type).toBe("text");
    const payload = JSON.parse(jsonBlock.text!) as { items: Array<{ id: string; title: string }> };
    expect(payload.items.map((a) => a.id)).toContain(artifact.id);
    // Metadata-only: no field on any list item carries file bytes.
    expect(JSON.stringify(payload)).not.toContain("blob");
  });

  it("denies a tool call for an artifact outside the caller's audience and audits it (route=mcp)", async () => {
    const owner = await makeActiveUser(`owner-${randomUUID()}@test.local`);
    const outsider = await makeActiveUser(`outsider-${randomUUID()}@test.local`);
    const artifact = await prisma.artifact.create({
      data: {
        ownerId: owner.id,
        title: "Private",
        fileName: "f.txt",
        contentType: "text/plain",
        storageKey: `artifacts/${randomUUID()}/f.txt`,
        sizeBytes: BigInt(5),
        audienceType: "specific_users",
      },
    });

    const res = await rpcRequest(tokenFor(outsider.idpSub as string), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_artifact", arguments: { id: artifact.id } },
    }).expect(200);

    const envelope = parseSseBody(res.text);
    const result = envelope.result as { isError?: boolean };
    expect(result.isError).toBe(true);

    const events = await prisma.accessEvent.findMany({ where: { artifactId: artifact.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: outsider.id, route: "mcp", decision: "denied" });
  });

  it("reads the artifact:// resource over HTTP and returns blob + mimeType", async () => {
    const owner = await makeActiveUser(`owner-${randomUUID()}@test.local`);
    const artifact = await prisma.artifact.create({
      data: {
        ownerId: owner.id,
        title: "Resource read",
        fileName: "f.txt",
        contentType: "text/plain",
        storageKey: `artifacts/${randomUUID()}/f.txt`,
        sizeBytes: BigInt(5),
        audienceType: "public_authenticated",
      },
    });

    const { PutObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
    const env = getEnv();
    const s3 = new S3Client({ endpoint: env.AWS_ENDPOINT_URL_S3, region: env.AWS_REGION, forcePathStyle: true });
    await s3.send(
      new PutObjectCommand({ Bucket: env.BUCKET_NAME, Key: artifact.storageKey, Body: "hello", ContentType: "text/plain" }),
    );

    const res = await rpcRequest(tokenFor(owner.idpSub as string), {
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: `artifact://${artifact.id}` },
    }).expect(200);

    const envelope = parseSseBody(res.text);
    const result = envelope.result as { contents: Array<{ mimeType?: string; blob?: string }> };
    expect(result.contents[0]!.mimeType).toBe("text/plain");
    expect(Buffer.from(result.contents[0]!.blob!, "base64").toString("utf8")).toBe("hello");
  });

  it("405s GET /mcp (stateless mode doesn't support the server-push SSE stream)", async () => {
    const user = await makeActiveUser(`user-${randomUUID()}@test.local`);
    await request(app)
      .get("/mcp")
      .set("Authorization", `Bearer ${tokenFor(user.idpSub as string)}`)
      .expect(405);
  });
});
