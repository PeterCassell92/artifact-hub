import { jest } from "@jest/globals";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase, type TestDatabase } from "../../test-support/testDatabase";
import type { EnrichmentResult, ProposeEnrichmentInput } from "../../adapters/llm/enrichmentClient";
import type { ConversationSummaryResult, ProposeConversationSummaryInput } from "../../adapters/llm/conversationSummaryClient";

/** A minimal Claude Code transcript JSONL — mirrors the real shape verified against an actual
 * session log (see lib/claudeCodeTranscript.unit.test.ts for the fuller fixture). Two real turns
 * clears the reducer's isConversation threshold. */
const TRANSCRIPT_JSONL = [
  { type: "queue-operation", operation: "enqueue" },
  {
    type: "user",
    timestamp: "2026-08-17T12:28:32.489Z",
    message: { role: "user", content: [{ type: "text", text: "Fix the email domain authentication issue." }] },
  },
  {
    type: "assistant",
    timestamp: "2026-08-17T12:28:40.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "Fixed the DMARC record and updated the SPF entry." }] },
  },
]
  .map((l) => JSON.stringify(l))
  .join("\n");

describe("enrichArtifact (artifact.enrich handler)", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let makeEnrichArtifact: typeof import("./artifactEnrich").makeEnrichArtifact;
  let getPresignedUploadUrl: typeof import("../../storage/s3").getPresignedUploadUrl;
  let FakeEnrichmentClient: typeof import("../../adapters/llm/fakeEnrichmentClient").FakeEnrichmentClient;
  let FakeConversationSummaryClient: typeof import("../../adapters/llm/fakeConversationSummaryClient").FakeConversationSummaryClient;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = db.prisma;
    ({ makeEnrichArtifact } = await import("./artifactEnrich"));
    ({ getPresignedUploadUrl } = await import("../../storage/s3"));
    ({ FakeEnrichmentClient } = await import("../../adapters/llm/fakeEnrichmentClient"));
    ({ FakeConversationSummaryClient } = await import("../../adapters/llm/fakeConversationSummaryClient"));
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  async function makeOwner() {
    return prisma.user.create({
      data: { email: `owner-${Math.random()}@test.local`, name: "Test Owner", idpSub: `idp|${Math.random()}`, status: "active" },
    });
  }

  async function makeArtifact(
    ownerId: string,
    opts: { contentType?: string; content?: string; skipUpload?: boolean; sizeBytesOverride?: bigint } = {},
  ) {
    const storageKey = `artifacts/test-${Math.random()}`;
    const contentType = opts.contentType ?? "text/markdown";
    // Mirrors finalizeArtifact (database-service/artifacts.ts): sizeBytes moves off the
    // BigInt(0) draft placeholder once real content exists. A never-finalized (draft) artifact
    // stays at 0 — that's the `skipUpload` case used to test draft exclusion below.
    // `sizeBytesOverride` separately models a row that *claims* to be finalized (sizeBytes > 0)
    // but whose object is actually missing from storage — the production NoSuchKey scenario.
    const sizeBytes =
      opts.sizeBytesOverride ??
      (opts.content !== undefined && !opts.skipUpload ? BigInt(Buffer.byteLength(opts.content, "utf8")) : BigInt(0));
    const artifact = await prisma.artifact.create({
      data: {
        ownerId,
        title: `Doc ${Math.random()}`,
        fileName: "doc.md",
        contentType,
        storageKey,
        sizeBytes,
        audienceType: "specific_users",
      },
    });

    if (opts.content !== undefined && !opts.skipUpload) {
      const uploadUrl = await getPresignedUploadUrl(storageKey, { contentType });
      const res = await fetch(uploadUrl, { method: "PUT", body: opts.content, headers: { "Content-Type": contentType } });
      if (!res.ok) throw new Error(`test setup: PUT to MinIO failed (${res.status})`);
    }

    return artifact;
  }

  async function makeEnrichmentRow(artifactId: string, requestedById: string) {
    return prisma.artifactEnrichment.create({
      data: { artifactId, requestedById, trigger: "publish", status: "pending" },
    });
  }

  it("writes summary/topics/tags, creates only relationships clearing the threshold, and marks the run completed", async () => {
    const owner = await makeOwner();
    const primary = await makeArtifact(owner.id, { content: "# Q3 Architecture\n\nA write-up about our new service mesh." });
    const strongCandidate = await makeArtifact(owner.id, { content: "An earlier draft of the same architecture." });
    const weakCandidate = await makeArtifact(owner.id, { content: "Unrelated lunch menu for the office." });
    const enrichment = await makeEnrichmentRow(primary.id, owner.id);

    const fakeClient = new FakeEnrichmentClient({
      result: {
        summary: "A write-up about the new service mesh architecture.",
        topics: ["service mesh", "architecture"],
        tags: [{ name: "architecture", confidence: 0.9 }],
        relationships: [
          { toArtifactId: strongCandidate.id, type: "related_to", confidence: 0.95 },
          { toArtifactId: weakCandidate.id, type: "related_to", confidence: 0.2 },
        ],
      },
    });

    const enrichArtifact = makeEnrichArtifact(fakeClient);
    await enrichArtifact({ artifactId: primary.id, enrichmentId: enrichment.id });

    const updatedArtifact = await prisma.artifact.findUniqueOrThrow({ where: { id: primary.id } });
    expect(updatedArtifact.aiSummary).toBe("A write-up about the new service mesh architecture.");
    expect(updatedArtifact.aiTopics).toEqual(["service mesh", "architecture"]);

    const tags = await prisma.artifactTag.findMany({ where: { artifactId: primary.id }, include: { tag: true } });
    expect(tags).toHaveLength(1);
    expect(tags[0]?.tag.name).toBe("architecture");
    expect(tags[0]?.source).toBe("ai");
    expect(tags[0]?.confidence).toBeCloseTo(0.9);

    const relationships = await prisma.artifactRelationship.findMany({ where: { fromId: primary.id } });
    expect(relationships).toHaveLength(1);
    expect(relationships[0]?.toId).toBe(strongCandidate.id);
    expect(relationships[0]?.source).toBe("ai");
    expect(relationships[0]?.confidence).toBeCloseTo(0.95);

    const finalRun = await prisma.artifactEnrichment.findUniqueOrThrow({ where: { id: enrichment.id } });
    expect(finalRun.status).toBe("completed");
    expect(finalRun.tagsAdded).toEqual(["architecture"]);
    const proposed = finalRun.relationshipsProposed as { toId: string; accepted: boolean }[];
    expect(proposed).toHaveLength(2);
    expect(proposed.find((p) => p.toId === strongCandidate.id)?.accepted).toBe(true);
    expect(proposed.find((p) => p.toId === weakCandidate.id)?.accepted).toBe(false);

    // The primary artifact's content read for inference is audited as a `system`-route AccessEvent
    // (docs/future-features/AI-features.md: "the model read this should be as traceable as a human view").
    const accessEvents = await prisma.accessEvent.findMany({ where: { artifactId: primary.id, route: "system" } });
    expect(accessEvents.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("marks the run skipped, without calling the LLM, for non-text content", async () => {
    const owner = await makeOwner();
    const artifact = await makeArtifact(owner.id, { contentType: "image/png" });
    const enrichment = await makeEnrichmentRow(artifact.id, owner.id);

    const proposeEnrichment = jest.fn<(input: ProposeEnrichmentInput) => Promise<EnrichmentResult>>();
    const enrichArtifact = makeEnrichArtifact({ proposeEnrichment });
    await enrichArtifact({ artifactId: artifact.id, enrichmentId: enrichment.id });

    expect(proposeEnrichment).not.toHaveBeenCalled();
    const finalRun = await prisma.artifactEnrichment.findUniqueOrThrow({ where: { id: enrichment.id } });
    expect(finalRun.status).toBe("skipped");
  }, 30_000);

  it("marks the run failed and rethrows (so the outbox retries) when the LLM call errors", async () => {
    const owner = await makeOwner();
    const artifact = await makeArtifact(owner.id, { content: "some content" });
    const enrichment = await makeEnrichmentRow(artifact.id, owner.id);

    const enrichArtifact = makeEnrichArtifact({
      proposeEnrichment: () => Promise.reject(new Error("bedrock unavailable")),
    });

    await expect(enrichArtifact({ artifactId: artifact.id, enrichmentId: enrichment.id })).rejects.toThrow("bedrock unavailable");

    const finalRun = await prisma.artifactEnrichment.findUniqueOrThrow({ where: { id: enrichment.id } });
    expect(finalRun.status).toBe("failed");
    expect(finalRun.error).toContain("bedrock unavailable");
  }, 30_000);

  it("throws (so the outbox retries) when the payload is malformed", async () => {
    const enrichArtifact = makeEnrichArtifact(new FakeEnrichmentClient());
    await expect(enrichArtifact({ artifactId: "only-an-id" })).rejects.toThrow();
  });

  it("generates and persists a conversationSummary for a recognized Claude Code transcript", async () => {
    const owner = await makeOwner();
    const artifact = await makeArtifact(owner.id, { content: TRANSCRIPT_JSONL, contentType: "application/jsonl" });
    const enrichment = await makeEnrichmentRow(artifact.id, owner.id);

    const enrichArtifact = makeEnrichArtifact(
      new FakeEnrichmentClient(),
      new FakeConversationSummaryClient({ result: { conversationSummary: "Fixed the DMARC and SPF records." } }),
    );
    await enrichArtifact({ artifactId: artifact.id, enrichmentId: enrichment.id });

    const updatedArtifact = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    expect(updatedArtifact.conversationSummary).toBe("Fixed the DMARC and SPF records.");
    // Deterministic facts from lib/claudeCodeTranscript.ts, not the (fake) LLM call.
    expect(updatedArtifact.conversationMessageCount).toBe(2);
    expect(updatedArtifact.conversationFirstMessageAt?.toISOString()).toBe("2026-08-17T12:28:32.489Z");
    expect(updatedArtifact.conversationFinalMessageAt?.toISOString()).toBe("2026-08-17T12:28:40.000Z");

    const finalRun = await prisma.artifactEnrichment.findUniqueOrThrow({ where: { id: enrichment.id } });
    expect(finalRun.status).toBe("completed");
    expect(finalRun.conversationSummary).toBe("Fixed the DMARC and SPF records.");
    expect(finalRun.conversationMessageCount).toBe(2);
    expect(finalRun.conversationFirstMessageAt?.toISOString()).toBe("2026-08-17T12:28:32.489Z");
    expect(finalRun.conversationFinalMessageAt?.toISOString()).toBe("2026-08-17T12:28:40.000Z");
  }, 30_000);

  it("never calls the conversation-summary client for non-transcript content, and leaves conversationSummary null", async () => {
    const owner = await makeOwner();
    const artifact = await makeArtifact(owner.id, { content: "# Q3 Architecture\n\nJust a regular markdown doc." });
    const enrichment = await makeEnrichmentRow(artifact.id, owner.id);

    const proposeConversationSummary =
      jest.fn<(input: ProposeConversationSummaryInput) => Promise<ConversationSummaryResult>>();
    const enrichArtifact = makeEnrichArtifact(new FakeEnrichmentClient(), { proposeConversationSummary });
    await enrichArtifact({ artifactId: artifact.id, enrichmentId: enrichment.id });

    expect(proposeConversationSummary).not.toHaveBeenCalled();
    const updatedArtifact = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    expect(updatedArtifact.conversationSummary).toBeNull();
    const finalRun = await prisma.artifactEnrichment.findUniqueOrThrow({ where: { id: enrichment.id } });
    expect(finalRun.status).toBe("completed");
    expect(finalRun.conversationSummary).toBeNull();
  }, 30_000);

  it("still completes the main enrichment when the conversation-summary call fails (best-effort)", async () => {
    const owner = await makeOwner();
    const artifact = await makeArtifact(owner.id, { content: TRANSCRIPT_JSONL, contentType: "application/jsonl" });
    const enrichment = await makeEnrichmentRow(artifact.id, owner.id);

    const enrichArtifact = makeEnrichArtifact(
      new FakeEnrichmentClient(),
      new FakeConversationSummaryClient({ error: new Error("bedrock unavailable") }),
    );
    await enrichArtifact({ artifactId: artifact.id, enrichmentId: enrichment.id });

    const updatedArtifact = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    expect(updatedArtifact.aiSummary).not.toBeNull(); // main enrichment still succeeded
    expect(updatedArtifact.conversationSummary).toBeNull();
    // Deterministic facts don't depend on the (failed) LLM call — still persisted.
    expect(updatedArtifact.conversationMessageCount).toBe(2);
    expect(updatedArtifact.conversationFirstMessageAt).not.toBeNull();

    const finalRun = await prisma.artifactEnrichment.findUniqueOrThrow({ where: { id: enrichment.id } });
    expect(finalRun.status).toBe("completed");
    expect(finalRun.conversationSummary).toBeNull();
    expect(finalRun.conversationMessageCount).toBe(2);
  }, 30_000);

  it("excludes draft (never-finalized, sizeBytes === 0) artifacts from the candidate corpus", async () => {
    const owner = await makeOwner();
    const primary = await makeArtifact(owner.id, { content: "# Notes\n\nSome real content." });
    const draftCandidate = await makeArtifact(owner.id, {
      content: "Draft content that never finished uploading.",
      skipUpload: true,
    });
    const enrichment = await makeEnrichmentRow(primary.id, owner.id);

    const proposeEnrichment = jest
      .fn<(input: ProposeEnrichmentInput) => Promise<EnrichmentResult>>()
      .mockResolvedValue({ summary: "summary", topics: [], tags: [], relationships: [] });
    const enrichArtifact = makeEnrichArtifact({ proposeEnrichment });
    await enrichArtifact({ artifactId: primary.id, enrichmentId: enrichment.id });

    expect(proposeEnrichment).toHaveBeenCalledTimes(1);
    const input = proposeEnrichment.mock.calls[0]?.[0];
    expect(input?.candidates.map((c) => c.id)).not.toContain(draftCandidate.id);
  }, 30_000);

  it("treats an unreadable candidate (finalized row, missing object) as unavailable without failing the run", async () => {
    const owner = await makeOwner();
    const primary = await makeArtifact(owner.id, { content: "# Notes\n\nSome real content." });
    // Row claims to be finalized (sizeBytes > 0, so it clears the draft filter) but its object was
    // never actually uploaded — the exact NoSuchKey shape seen in production.
    const strandedCandidate = await makeArtifact(owner.id, {
      content: "content that was never actually uploaded",
      skipUpload: true,
      sizeBytesOverride: BigInt(42),
    });
    const enrichment = await makeEnrichmentRow(primary.id, owner.id);

    let capturedReadCandidateContent: ProposeEnrichmentInput["readCandidateContent"] | undefined;
    const proposeEnrichment = jest
      .fn<(input: ProposeEnrichmentInput) => Promise<EnrichmentResult>>()
      .mockImplementation(async (input) => {
        capturedReadCandidateContent = input.readCandidateContent;
        return { summary: "summary", topics: [], tags: [], relationships: [] };
      });
    const enrichArtifact = makeEnrichArtifact({ proposeEnrichment });
    await enrichArtifact({ artifactId: primary.id, enrichmentId: enrichment.id });

    expect(capturedReadCandidateContent).toBeDefined();
    await expect(capturedReadCandidateContent?.(strandedCandidate.id)).resolves.toBeNull();

    const finalRun = await prisma.artifactEnrichment.findUniqueOrThrow({ where: { id: enrichment.id } });
    expect(finalRun.status).toBe("completed");
  }, 30_000);
});
