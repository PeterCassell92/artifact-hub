import { BedrockChatService } from "./bedrockChatService";
import { enrichmentAgentConfig, type EnrichmentPromptParams } from "./agent-definitions/artifact-metadata-enrichment/enrichment_agent-config";
import type { EnrichmentCandidateArtifact, EnrichmentLlmClient, EnrichmentResult, ProposeEnrichmentInput } from "./enrichmentClient";

function formatCandidateList(candidates: EnrichmentCandidateArtifact[]): string {
  return (
    candidates
      .map(
        (c) =>
          `- id: ${c.id}\n  title: ${c.title}\n  kind: ${c.kind}\n  tags: ${c.tags.join(", ") || "(none)"}\n  existing summary: ${c.aiSummary ?? "(not yet enriched)"}\n  existing topics: ${c.aiTopics.join(", ") || "(none)"}`,
      )
      .join("\n") || "(none)"
  );
}

function toPromptParams(input: ProposeEnrichmentInput): EnrichmentPromptParams {
  return {
    primaryArtifactId: input.primaryArtifact.id,
    primaryArtifactTitle: input.primaryArtifact.title,
    primaryArtifactContentType: input.primaryArtifact.contentType,
    primaryArtifactContent: input.primaryArtifact.content,
    existingTags: input.existingTags.join(", ") || "(none)",
    candidateList: formatCandidateList(input.candidates),
    confidenceThreshold: input.confidenceThreshold,
  };
}

const chatService = new BedrockChatService();

/** Real implementation — Claude Sonnet via AWS Bedrock, run through the general-purpose
 * `BedrockChatService` against the `artifact-metadata-enrichment` agent definition. This file's
 * only job is bridging `EnrichmentLlmClient`'s app-level port (defined against this app's own
 * `ProposeEnrichmentInput`/`EnrichmentResult` shapes) onto that agent definition's generic
 * prompt-params/tool-handler/output shapes — no Bedrock-calling logic of its own. */
export class BedrockEnrichmentClient implements EnrichmentLlmClient {
  async proposeEnrichment(input: ProposeEnrichmentInput): Promise<EnrichmentResult> {
    const candidateIds = new Set(input.candidates.map((c) => c.id));

    return chatService.run(enrichmentAgentConfig, toPromptParams(input), {
      read_candidate_content: async (args) => {
        const artifactId = (args as { artifactId: string }).artifactId;
        const content = candidateIds.has(artifactId) ? await input.readCandidateContent(artifactId) : null;
        return content ?? `No content available for artifact ${artifactId ?? "(invalid id)"}.`;
      },
    });
  }
}
