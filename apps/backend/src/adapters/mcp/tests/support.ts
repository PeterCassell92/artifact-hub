import { randomUUID } from "node:crypto";
import type { Artifact, PrismaClient, User } from "@prisma/client";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getEnv } from "#env";
import { logger } from "#logger";
import { startTestDatabase, type TestDatabase } from "../../../test-support/testDatabase";

/**
 * Shared setup/helpers for the MCP in-memory test suites (docs/architecture/09 §4) — split by
 * tool/feature across this folder rather than one large file. Each suite gets its own
 * Testcontainers Postgres (same pattern as every other *.int.test.ts / *.mcp.test.ts file), so
 * splitting doesn't share state between suites; within one suite, tests DO share one database
 * (no per-test reset) — see the "unique marker per test" note in artifactListing.mcp.test.ts.
 */
export interface McpTestContext {
  db: TestDatabase;
  prisma: PrismaClient;
  connectAsUser: (email: string, groupIds?: string[]) => Promise<{ client: Client; user: User }>;
  makeActiveUser: (email: string) => Promise<User>;
  makeArtifact: (over: MakeArtifactInput) => Promise<Artifact>;
}

export async function setupMcpTestContext(): Promise<McpTestContext> {
  const db = await startTestDatabase();
  const prisma = db.prisma;

  // getEnv() is safe to call once startTestDatabase() has set process.env.DATABASE_URL — env.ts
  // has no import-time side effect (it only parses/caches on first *call*), unlike db.ts below.
  const env = getEnv();
  const bucket = env.BUCKET_NAME;
  const s3 = new S3Client({ endpoint: env.AWS_ENDPOINT_URL_S3, region: env.AWS_REGION, forcePathStyle: true });

  // createMcpServer MUST stay a dynamic import: it transitively imports db.ts, which constructs
  // its PrismaClient at module top level from getEnv().DATABASE_URL. A static import would
  // resolve (and cache) DATABASE_URL before startTestDatabase() above ever runs.
  const { createMcpServer } = await import("#mcp-server");

  async function makeActiveUser(email: string): Promise<User> {
    return prisma.user.create({ data: { email, name: "Test User", idpSub: `idp|${email}`, status: "active" } });
  }

  // `groupIds` are assigned BEFORE the viewer snapshot is built (below) — unlike production, where
  // mountMcp resolves a fresh viewer (incl. group membership) on every single HTTP request, this
  // in-memory test connection stays open and reuses one snapshotted viewer for its whole lifetime,
  // so membership changes made after connecting would never be reflected on that same client.
  async function connectAsUser(email: string, groupIds: string[] = []) {
    const user = await makeActiveUser(email);
    for (const groupId of groupIds) {
      await prisma.groupMembership.create({ data: { userId: user.id, groupId } });
    }
    const memberships = await prisma.groupMembership.findMany({ where: { userId: user.id } });
    const viewer = { id: user.id, status: user.status, role: user.role, groupIds: memberships.map((m) => m.groupId) };
    const server = createMcpServer(viewer, logger);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, user };
  }

  async function putObject(key: string, body: string, contentType: string) {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async function makeArtifact(over: MakeArtifactInput): Promise<Artifact> {
    const id = randomUUID();
    const contentType = over.contentType ?? "text/plain";
    const storageKey = `artifacts/${id}/test-file`;
    const body = over.body ?? "hello world";

    const artifact = await prisma.artifact.create({
      data: {
        id,
        ownerId: over.ownerId,
        title: over.title ?? "Untitled",
        fileName: "test-file.txt",
        contentType,
        storageKey,
        sizeBytes: BigInt(Buffer.byteLength(body)),
        audienceType: over.audienceType ?? "specific_users",
        expiresAt: over.expiresAt ?? null,
      },
    });

    for (const userId of over.allowedUserIds ?? []) {
      await prisma.artifactAllowedUser.create({ data: { artifactId: artifact.id, userId } });
    }
    for (const groupId of over.allowedGroupIds ?? []) {
      await prisma.artifactAllowedGroup.create({ data: { artifactId: artifact.id, groupId } });
    }

    await putObject(storageKey, body, contentType);
    return artifact;
  }

  return { db, prisma, connectAsUser, makeActiveUser, makeArtifact };
}

export async function teardownMcpTestContext(ctx: McpTestContext): Promise<void> {
  await ctx.db.stop();
}

export interface MakeArtifactInput {
  ownerId: string;
  title?: string;
  audienceType?: "public_authenticated" | "specific_users" | "user_groups";
  expiresAt?: Date | null;
  allowedUserIds?: string[];
  allowedGroupIds?: string[];
  contentType?: string;
  body?: string;
}

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
export type ContentBlock = { type: string; text?: string; uri?: string; resource?: { text?: string; blob?: string } };

/** The content blocks of a tool result, typed loosely enough to cover every block shape we assert on. */
export function contentBlocks(result: ToolResult): ContentBlock[] {
  return (result as { content: ContentBlock[] }).content;
}

/** Every Artifact Hub tool result ends with a JSON text block (see toolHelpers.ts's `toolJson`) — parse it. */
export function textPayload(result: ToolResult): unknown {
  const last = contentBlocks(result).at(-1);
  return JSON.parse(last!.text!);
}
