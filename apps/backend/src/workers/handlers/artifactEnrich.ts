import type { EnrichmentRelationshipCandidate } from "contracts";
import { isTextLike } from "../../lib/contentType";
import { isClaudeCodeTranscriptContentType, reduceClaudeCodeTranscript } from "../../lib/claudeCodeTranscript";
import {
  ENRICHMENT_MAX_CANDIDATE_ARTIFACTS,
  ENRICHMENT_MAX_CONTENT_BYTES,
  ENRICHMENT_RELATIONSHIP_CONFIDENCE_THRESHOLD,
} from "../../config";
import { logger } from "../../logger";
import { getObjectBuffer } from "../../storage/s3";
import {
  attachAiTags,
  findArtifactForDetail,
  listOwnedArtifacts,
  setArtifactAiMetadata,
  type ArtifactWithPolicyJoins,
} from "../../database-service/artifacts";
import { loadViewerById } from "../../database-service/adminUsers";
import { createRelationship } from "../../database-service/relationships";
import { recordAccessEvent } from "../../database-service/accessEvents";
import {
  markEnrichmentCompleted,
  markEnrichmentFailed,
  markEnrichmentRunning,
  markEnrichmentSkipped,
} from "../../database-service/enrichment";
import { BedrockEnrichmentClient } from "../../adapters/llm/bedrockEnrichmentClient";
import type { EnrichmentCandidateArtifact, EnrichmentLlmClient } from "../../adapters/llm/enrichmentClient";
import { BedrockConversationSummaryClient } from "../../adapters/llm/bedrockConversationSummaryClient";
import type { ConversationSummaryLlmClient } from "../../adapters/llm/conversationSummaryClient";
import type { OutboxHandler } from "../outboxDrain";

interface ArtifactEnrichPayload extends Record<string, unknown> {
  artifactId: string;
  enrichmentId: string;
}

function isArtifactEnrichPayload(payload: Record<string, unknown>): payload is ArtifactEnrichPayload {
  return typeof payload.artifactId === "string" && typeof payload.enrichmentId === "string";
}

function toCandidateProjection(artifact: ArtifactWithPolicyJoins): EnrichmentCandidateArtifact {
  return {
    id: artifact.id,
    title: artifact.title,
    kind: artifact.kind,
    tags: artifact.tags.map((t) => t.tag.name),
    aiSummary: artifact.aiSummary,
    aiTopics: artifact.aiTopics,
  };
}

interface ReadContentResult {
  text: string;
  /** True only when this artifact's content is JSONL recognized as a Claude Code transcript with
   * real back-and-forth (lib/claudeCodeTranscript.ts). Only meaningful for the primary artifact —
   * candidates never trigger a conversationSummary of their own. */
  isConversation: boolean;
  /** Deterministic facts from the reducer (never LLM-derived) — null unless `isConversation`. */
  messageCount: number | null;
  firstMessageDateTime: string | null;
  finalMessageDateTime: string | null;
}

/**
 * Reads one artifact's text content for the LLM prompt, auditing the read as a `system`-route
 * `AccessEvent` (docs/future-features/AI-features.md: "the model read this should be as
 * traceable as a human view"). Returns null for non-text content — v1 only has LLMs parse/enrich
 * metadata for text-like files.
 *
 * For content recognized as a Claude Code transcript (docs/architecture/01 decision #46
 * addendum), deterministically reduces it to just the user/assistant text turns *before*
 * truncating — raw session logs are dominated by tool_use/tool_result/thinking/base64-image noise
 * that both wastes the content budget and can blow past Bedrock's own request-size limit. The
 * artifact in storage is never touched; this only shapes what gets sent to the LLM.
 */
async function readContentForEnrichment(
  artifact: ArtifactWithPolicyJoins,
  readerId: string,
): Promise<ReadContentResult | null> {
  if (!isTextLike(artifact.contentType)) return null;

  const { buffer } = await getObjectBuffer(artifact.storageKey);
  await recordAccessEvent({
    artifactId: artifact.id,
    userId: readerId,
    route: "system",
    action: "view",
    decision: "allowed",
  });

  const rawText = buffer.toString("utf8");
  let text = rawText;
  let isConversation = false;
  let messageCount: number | null = null;
  let firstMessageDateTime: string | null = null;
  let finalMessageDateTime: string | null = null;

  if (isClaudeCodeTranscriptContentType(artifact.contentType)) {
    const reduced = reduceClaudeCodeTranscript(rawText);
    isConversation = reduced.isConversation;
    if (reduced.isConversation) {
      text = reduced.asText;
      messageCount = reduced.messageCount;
      firstMessageDateTime = reduced.firstMessageDateTime;
      finalMessageDateTime = reduced.finalMessageDateTime;
    }
  }

  return {
    text: text.length > ENRICHMENT_MAX_CONTENT_BYTES ? text.slice(0, ENRICHMENT_MAX_CONTENT_BYTES) : text,
    isConversation,
    messageCount,
    firstMessageDateTime,
    finalMessageDateTime,
  };
}

async function readTextContentForEnrichment(artifact: ArtifactWithPolicyJoins, readerId: string): Promise<string | null> {
  const result = await readContentForEnrichment(artifact, readerId);
  return result?.text ?? null;
}

/**
 * Drains "artifact.enrich" outbox rows — the automatic AI enrichment job triggered by
 * `finalizeArtifact` (or a rerun from the SPA/MCP), docs/architecture/01 decision #46. Reads the
 * primary artifact's content plus the owner's other artifacts (lightweight metadata only),
 * proposes a summary/topics/tags/relationships via `EnrichmentLlmClient`, and writes whatever
 * clears the confidence threshold. For a recognized conversation transcript, also runs a separate,
 * best-effort `conversationSummary` call — its failure never fails the main enrichment run.
 */
export function makeEnrichArtifact(
  llmClient: EnrichmentLlmClient = new BedrockEnrichmentClient(),
  conversationSummaryClient: ConversationSummaryLlmClient = new BedrockConversationSummaryClient(),
): OutboxHandler {
  return async (payload) => {
    if (!isArtifactEnrichPayload(payload)) {
      throw new Error("artifact.enrich payload missing required fields");
    }

    const { artifactId, enrichmentId } = payload;
    const start = Date.now();
    await markEnrichmentRunning(enrichmentId);

    try {
      const artifact = await findArtifactForDetail(artifactId);
      if (!artifact) throw new Error(`artifact ${artifactId} not found`);

      const primaryRead = await readContentForEnrichment(artifact, artifact.ownerId);
      if (primaryRead === null) {
        await markEnrichmentSkipped(enrichmentId, `content type "${artifact.contentType}" is not text-like`);
        logger.info({ artifactId, enrichmentId, status: "skipped" }, "artifact enrichment");
        return;
      }
      const { text: primaryContent, isConversation, messageCount, firstMessageDateTime, finalMessageDateTime } = primaryRead;

      const { items: ownedArtifacts, nextCursor } = await listOwnedArtifacts(artifact.ownerId, {
        limit: ENRICHMENT_MAX_CANDIDATE_ARTIFACTS + 1,
      });
      // Excludes drafts (sizeBytes === 0, never finalized — the same signal behind
      // ArtifactPolicy.pending, decision #47). listOwnedArtifacts intentionally still returns
      // drafts for "My Artifacts", but a draft has no object in storage, so offering one as an
      // enrichment candidate only ever produces an unreadable candidate.
      const candidates = ownedArtifacts
        .filter((a) => a.id !== artifactId && a.sizeBytes > BigInt(0))
        .slice(0, ENRICHMENT_MAX_CANDIDATE_ARTIFACTS);
      if (nextCursor) {
        logger.warn(
          { artifactId, enrichmentId, considered: candidates.length, cap: ENRICHMENT_MAX_CANDIDATE_ARTIFACTS },
          "artifact enrichment candidate corpus truncated",
        );
      }
      const candidateById = new Map(candidates.map((c) => [c.id, c]));
      const contentCache = new Map<string, string | null>();

      // Main enrichment and (when a conversation was detected) the conversation-summary call run
      // concurrently. `Promise.allSettled`, not `Promise.all` — a conversation-summary failure
      // must never fail the main enrichment run (confirmed design), so its rejection is inspected
      // below rather than propagating.
      const [enrichmentOutcome, conversationSummaryOutcome] = await Promise.allSettled([
        llmClient.proposeEnrichment({
          primaryArtifact: {
            id: artifact.id,
            title: artifact.title,
            contentType: artifact.contentType,
            content: primaryContent,
          },
          existingTags: artifact.tags.map((t) => t.tag.name),
          candidates: candidates.map(toCandidateProjection),
          confidenceThreshold: ENRICHMENT_RELATIONSHIP_CONFIDENCE_THRESHOLD,
          readCandidateContent: async (candidateId) => {
            if (contentCache.has(candidateId)) return contentCache.get(candidateId)!;
            const candidate = candidateById.get(candidateId);
            // Only ever resolves ids from the pre-authorized candidate set built above — never a
            // free-form lookup, so a hallucinated id just gets "no content available" back.
            let content: string | null = null;
            if (candidate) {
              try {
                content = await readTextContentForEnrichment(candidate, artifact.ownerId);
              } catch (err) {
                // A candidate's object can be unreadable (e.g. a stranded row whose upload never
                // landed) without that invalidating the primary artifact's own enrichment — degrade
                // to "no content available" for this one candidate rather than failing the run.
                logger.warn(
                  { err, artifactId, enrichmentId, candidateId },
                  "artifact enrichment candidate content unreadable — skipping content for this candidate",
                );
              }
            }
            contentCache.set(candidateId, content);
            return content;
          },
        }),
        isConversation
          ? conversationSummaryClient.proposeConversationSummary({
              artifactTitle: artifact.title,
              transcript: primaryContent,
            })
          : Promise.resolve(null),
      ]);

      if (enrichmentOutcome.status === "rejected") throw enrichmentOutcome.reason;
      const result = enrichmentOutcome.value;

      let conversationSummary: string | null = null;
      if (isConversation) {
        if (conversationSummaryOutcome.status === "fulfilled" && conversationSummaryOutcome.value) {
          conversationSummary = conversationSummaryOutcome.value.conversationSummary;
        } else if (conversationSummaryOutcome.status === "rejected") {
          logger.warn(
            { err: conversationSummaryOutcome.reason, artifactId, enrichmentId },
            "conversation summary generation failed — best-effort, main enrichment unaffected",
          );
        }
      }

      const existingTagNames = new Set(artifact.tags.map((t) => t.tag.name.toLowerCase()));
      const newTags = result.tags.filter((t) => !existingTagNames.has(t.name.toLowerCase()));
      if (newTags.length) await attachAiTags(artifactId, newTags);

      await setArtifactAiMetadata(artifactId, {
        summary: result.summary,
        topics: result.topics,
        conversationSummary: conversationSummary ?? undefined,
        conversationMessageCount: messageCount ?? undefined,
        conversationFirstMessageAt: firstMessageDateTime ? new Date(firstMessageDateTime) : undefined,
        conversationFinalMessageAt: finalMessageDateTime ? new Date(finalMessageDateTime) : undefined,
      });

      const linker = await loadViewerById(artifact.ownerId);
      if (!linker) throw new Error(`owner ${artifact.ownerId} not found`);

      const relationshipsProposed: EnrichmentRelationshipCandidate[] = [];
      for (const rel of result.relationships) {
        // Defense in depth: only ever act on a `toArtifactId` that was actually offered as a
        // candidate — closes off a hallucinated id from being linked even though
        // `createRelationship`'s own canView check would otherwise allow linking to anything the
        // owner can view, not just this run's pre-authorized candidate set.
        const isKnownCandidate = candidateById.has(rel.toArtifactId);
        const accepted = isKnownCandidate && rel.confidence >= ENRICHMENT_RELATIONSHIP_CONFIDENCE_THRESHOLD;

        if (accepted) {
          const created = await createRelationship(
            artifactId,
            linker,
            { toId: rel.toArtifactId, type: rel.type },
            { source: "ai", confidence: rel.confidence },
          );
          relationshipsProposed.push({
            toId: rel.toArtifactId,
            type: rel.type,
            confidence: rel.confidence,
            accepted: created.ok,
          });
        } else {
          relationshipsProposed.push({
            toId: rel.toArtifactId,
            type: rel.type,
            confidence: rel.confidence,
            accepted: false,
          });
        }
      }

      await markEnrichmentCompleted(enrichmentId, {
        summary: result.summary,
        topics: result.topics,
        tagsAdded: newTags.map((t) => t.name),
        relationshipsProposed,
        conversationSummary,
        conversationMessageCount: messageCount,
        conversationFirstMessageAt: firstMessageDateTime ? new Date(firstMessageDateTime) : null,
        conversationFinalMessageAt: finalMessageDateTime ? new Date(finalMessageDateTime) : null,
      });

      logger.info(
        {
          artifactId,
          enrichmentId,
          status: "completed",
          latencyMs: Date.now() - start,
          tagsAdded: newTags.length,
          relationshipsAccepted: relationshipsProposed.filter((r) => r.accepted).length,
          relationshipsConsidered: relationshipsProposed.length,
          isConversation,
          conversationSummaryGenerated: conversationSummary !== null,
        },
        "artifact enrichment",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markEnrichmentFailed(enrichmentId, message);
      logger.error({ err, artifactId, enrichmentId, latencyMs: Date.now() - start }, "artifact enrichment failed");
      throw err;
    }
  };
}

/** Real-Bedrock singleton for `index.ts`'s handler registration. */
export const enrichArtifact: OutboxHandler = makeEnrichArtifact();
