import { z } from "zod";
import { EnrichmentStatus, RelationType } from "./enums";

/** One candidate relationship the enrichment job considered — whether or not it cleared the
 * confidence threshold. Lets a "why wasn't X linked" view work without re-running the job. */
export const EnrichmentRelationshipCandidate = z.object({
  toId: z.string().uuid(),
  type: RelationType,
  confidence: z.number().min(0).max(1),
  accepted: z.boolean(),
});
export type EnrichmentRelationshipCandidate = z.infer<typeof EnrichmentRelationshipCandidate>;

/** One run of the enrichment job for one artifact — `GET .../enrichment` (HTTP) /
 * `get_enrichment_status` (MCP) row shape. Append-only history, not just the latest run. */
export const ArtifactEnrichmentView = z.object({
  id: z.string().uuid(),
  status: EnrichmentStatus,
  trigger: z.enum(["publish", "rerun"]),
  requestedByName: z.string(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
  summary: z.string().nullable(),
  topics: z.array(z.string()),
  tagsAdded: z.array(z.string()),
  relationshipsProposed: z.array(EnrichmentRelationshipCandidate),
  /** Set only when this run detected a conversation transcript and the best-effort
   * conversation-summary call succeeded — null otherwise (never a run-failure signal on its own). */
  conversationSummary: z.string().nullable(),
  /** Deterministic (never LLM-derived) — set whenever this run detected a conversation,
   * independent of whether `conversationSummary` itself succeeded. */
  conversationMessageCount: z.number().int().nonnegative().nullable(),
  conversationFirstMessageAt: z.string().datetime().nullable(),
  conversationFinalMessageAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ArtifactEnrichmentView = z.infer<typeof ArtifactEnrichmentView>;

/** `GET /api/artifacts/:id/enrichment` response — newest first. */
export const ArtifactEnrichmentListResponse = z.object({
  items: z.array(ArtifactEnrichmentView),
});
export type ArtifactEnrichmentListResponse = z.infer<typeof ArtifactEnrichmentListResponse>;

/** `POST /api/artifacts/:id/enrich` response — the freshly-created (pending) run. */
export const TriggerEnrichmentResponse = z.object({
  enrichmentId: z.string().uuid(),
  status: EnrichmentStatus,
});
export type TriggerEnrichmentResponse = z.infer<typeof TriggerEnrichmentResponse>;
