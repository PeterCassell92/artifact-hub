import type { EnrichmentLlmClient, EnrichmentResult, ProposeEnrichmentInput } from "./enrichmentClient";

/**
 * Test-only double for `EnrichmentLlmClient` — deterministic, no network call, so integration
 * tests can exercise the worker handler's write paths (ArtifactEnrichment/Artifact/ArtifactTag/
 * ArtifactRelationship) without hitting real Bedrock (docs/future-features/AI-features.md's
 * "keep the LLM boundary behind an interface so it can be stubbed in tests").
 *
 * Returns a canned result by default; pass a `result` (or `resultFor`, keyed by primary artifact
 * id) to control what a specific test scenario gets back.
 */
export class FakeEnrichmentClient implements EnrichmentLlmClient {
  constructor(
    private readonly options: {
      result?: EnrichmentResult;
      resultFor?: Record<string, EnrichmentResult>;
    } = {},
  ) {}

  async proposeEnrichment(input: ProposeEnrichmentInput): Promise<EnrichmentResult> {
    const configured = this.options.resultFor?.[input.primaryArtifact.id] ?? this.options.result;
    if (configured) return configured;

    return {
      summary: `Summary of ${input.primaryArtifact.title}.`,
      topics: [],
      tags: [],
      relationships: [],
    };
  }
}
