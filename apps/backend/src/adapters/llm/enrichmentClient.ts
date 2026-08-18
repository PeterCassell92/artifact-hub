import type { RelationType } from "contracts";

/** Lightweight projection of a candidate artifact the enrichment job may relate the primary
 * artifact to — title/kind/tags/existing AI summary only, never full content (that's what
 * `readCandidateContent` is for, lazily, per candidate the model actually wants to inspect). */
export interface EnrichmentCandidateArtifact {
  id: string;
  title: string;
  kind: string;
  tags: string[];
  aiSummary: string | null;
  aiTopics: string[];
}

export interface EnrichmentTagProposal {
  name: string;
  confidence: number;
}

export interface EnrichmentRelationshipProposal {
  toArtifactId: string;
  type: RelationType;
  confidence: number;
}

export interface EnrichmentResult {
  summary: string;
  topics: string[];
  tags: EnrichmentTagProposal[];
  relationships: EnrichmentRelationshipProposal[];
}

export interface ProposeEnrichmentInput {
  primaryArtifact: { id: string; title: string; contentType: string; content: string };
  existingTags: string[];
  candidates: EnrichmentCandidateArtifact[];
  /** The prompt explains this threshold so the model calibrates its confidence scores, but it is
   * NOT trusted to self-filter — the worker (workers/handlers/artifactEnrich.ts) enforces it in
   * code against every returned relationship before writing anything. */
  confidenceThreshold: number;
  /** Scoped, lazy content access for ONE of `candidates` — bound by the caller to the
   * pre-authorized candidate set with its own fetch/caching, never a free-form id lookup. Returns
   * null if the id isn't a known candidate (defensive; should never happen since the model is only
   * ever shown these ids) or the content couldn't be fetched. */
  readCandidateContent: (artifactId: string) => Promise<string | null>;
}

/** The LLM boundary — kept behind an interface so it's stubbable in tests without hitting real
 * Bedrock (docs/future-features/AI-features.md, docs/architecture/01 decision #46). */
export interface EnrichmentLlmClient {
  proposeEnrichment(input: ProposeEnrichmentInput): Promise<EnrichmentResult>;
}
