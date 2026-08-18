import { z } from "zod";
import type { AgentConfig, AgentToolDef } from "../types";
import { enrichmentPrompt } from "./enrichment_prompt";

/** Values `enrichment_prompt.ts` is formatted with — pre-flattened to strings/numbers since a
 * LangChain prompt template only does flat variable substitution. */
export const EnrichmentPromptParams = z.object({
  primaryArtifactId: z.string().uuid(),
  primaryArtifactTitle: z.string(),
  primaryArtifactContentType: z.string(),
  primaryArtifactContent: z.string(),
  /** Comma-joined, or "(none)". */
  existingTags: z.string(),
  /** Pre-formatted bullet list, or "(none)". */
  candidateList: z.string(),
  confidenceThreshold: z.number().min(0).max(1),
});
export type EnrichmentPromptParams = z.infer<typeof EnrichmentPromptParams>;

/** The agent's structured final answer — deliberately its own schema, not the app-level
 * `EnrichmentResult` type from `../../enrichmentClient.ts`: agent-definitions stay self-contained
 * and don't depend on any one consumer's port interface, even though `bedrockEnrichmentClient.ts`
 * currently maps this 1:1 onto `EnrichmentResult`. */
export const EnrichmentAgentOutput = z.object({
  summary: z.string().describe("A 1-3 sentence summary of the primary artifact's content."),
  topics: z.array(z.string()).describe("Notable topics, entities, or concepts in the content."),
  tags: z
    .array(z.object({ name: z.string(), confidence: z.number().min(0).max(1) }))
    .describe("Proposed tags not already in existingTags."),
  relationships: z
    .array(
      z.object({
        toArtifactId: z.string().uuid(),
        type: z.enum(["supersedes", "derived_from", "related_to"]),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .describe("How confident you are this relationship holds, calibrated against the stated threshold."),
      }),
    )
    .describe("Every candidate relationship you considered, including ones below the threshold."),
});
export type EnrichmentAgentOutput = z.infer<typeof EnrichmentAgentOutput>;

const readCandidateContentTool: AgentToolDef = {
  name: "read_candidate_content",
  description:
    "Read the full text content of one candidate artifact by id, when its metadata alone isn't enough to judge a relationship.",
  schema: z.object({
    artifactId: z.string().uuid().describe("The id of one of the listed candidate artifacts."),
  }),
};

export const enrichmentAgentConfig: AgentConfig<EnrichmentPromptParams, EnrichmentAgentOutput> = {
  model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  temperature: 0,
  prompt: enrichmentPrompt,
  promptParameters: EnrichmentPromptParams,
  outputSchema: EnrichmentAgentOutput,
  tools: [readCandidateContentTool],
  maxToolTurns: 4,
};
