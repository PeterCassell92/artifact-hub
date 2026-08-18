import type { Prisma } from "@prisma/client";
import type { ArtifactEnrichmentView, EnrichmentRelationshipCandidate } from "contracts";
import { prisma } from "../db";
import { enqueueOutboxEvent } from "./outbox";

type Client = Prisma.TransactionClient | typeof prisma;

/**
 * Creates the "pending" job record + its delivery outbox row together, so the row is visible to
 * the SPA/MCP status surfaces the instant a publish (or a rerun) completes, before the drain loop
 * even picks the outbox event up. Pass a transaction client from `finalizeArtifact` so the publish
 * write and this enqueue commit atomically (same pattern as every other outbox producer).
 */
export async function enqueueEnrichment(
  input: { artifactId: string; requestedById: string; trigger: "publish" | "rerun" },
  client: Client = prisma,
): Promise<{ enrichmentId: string }> {
  const enrichment = await client.artifactEnrichment.create({
    data: {
      artifactId: input.artifactId,
      requestedById: input.requestedById,
      trigger: input.trigger,
      status: "pending",
    },
  });

  await enqueueOutboxEvent(
    {
      type: "artifact.enrich",
      payload: { artifactId: input.artifactId, enrichmentId: enrichment.id },
      // A fresh idempotency key per run — "publish" is one-shot per artifact (at most one
      // auto-triggered enrichment per publish even under outbox retry semantics); "rerun" is
      // scoped to this specific enrichment row so repeated reruns never dedupe against each other.
      idempotencyKey:
        input.trigger === "publish"
          ? `enrich:${input.artifactId}:publish`
          : `enrich:${input.artifactId}:rerun:${enrichment.id}`,
    },
    client,
  );

  return { enrichmentId: enrichment.id };
}

export async function markEnrichmentRunning(enrichmentId: string): Promise<void> {
  await prisma.artifactEnrichment.update({
    where: { id: enrichmentId },
    data: { status: "running", startedAt: new Date() },
  });
}

export async function markEnrichmentSkipped(enrichmentId: string, reason: string): Promise<void> {
  await prisma.artifactEnrichment.update({
    where: { id: enrichmentId },
    data: { status: "skipped", completedAt: new Date(), error: reason },
  });
}

export interface CompleteEnrichmentInput {
  summary: string;
  topics: string[];
  tagsAdded: string[];
  relationshipsProposed: EnrichmentRelationshipCandidate[];
  /** Set only when this run detected a conversation transcript and the best-effort
   * conversation-summary call succeeded (docs/architecture/01 decision #46 addendum) — a failure
   * there never fails the run itself, it just leaves this undefined/null. */
  conversationSummary?: string | null;
  /** Deterministic (never LLM-derived) — set whenever this run detected a conversation,
   * independent of whether `conversationSummary` itself succeeded. */
  conversationMessageCount?: number | null;
  conversationFirstMessageAt?: Date | null;
  conversationFinalMessageAt?: Date | null;
}

export async function markEnrichmentCompleted(
  enrichmentId: string,
  input: CompleteEnrichmentInput,
): Promise<void> {
  await prisma.artifactEnrichment.update({
    where: { id: enrichmentId },
    data: {
      status: "completed",
      completedAt: new Date(),
      summary: input.summary,
      topics: input.topics,
      tagsAdded: input.tagsAdded,
      relationshipsProposed: input.relationshipsProposed as unknown as Prisma.InputJsonValue,
      conversationSummary: input.conversationSummary ?? null,
      conversationMessageCount: input.conversationMessageCount ?? null,
      conversationFirstMessageAt: input.conversationFirstMessageAt ?? null,
      conversationFinalMessageAt: input.conversationFinalMessageAt ?? null,
    },
  });
}

export async function markEnrichmentFailed(enrichmentId: string, error: string): Promise<void> {
  await prisma.artifactEnrichment.update({
    where: { id: enrichmentId },
    data: { status: "failed", completedAt: new Date(), error },
  });
}

/** Newest-first run history for one artifact — the `GET .../enrichment` (HTTP) /
 * `get_enrichment_status` (MCP) read side. Authorization (owner-only) is the caller's
 * responsibility, same as `listAccessEvents`. */
export async function listEnrichments(artifactId: string): Promise<ArtifactEnrichmentView[]> {
  const rows = await prisma.artifactEnrichment.findMany({
    where: { artifactId },
    orderBy: { createdAt: "desc" },
    include: { requestedBy: { select: { name: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    trigger: row.trigger as "publish" | "rerun",
    requestedByName: row.requestedBy.name,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    error: row.error,
    summary: row.summary,
    topics: row.topics,
    tagsAdded: row.tagsAdded,
    relationshipsProposed: row.relationshipsProposed as unknown as EnrichmentRelationshipCandidate[],
    conversationSummary: row.conversationSummary,
    conversationMessageCount: row.conversationMessageCount,
    conversationFirstMessageAt: row.conversationFirstMessageAt?.toISOString() ?? null,
    conversationFinalMessageAt: row.conversationFinalMessageAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}
