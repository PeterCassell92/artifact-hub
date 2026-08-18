// Git-committed application tunables — as opposed to env.ts, which is secrets/deployment-target
// config only. Changing one of these is a reviewable code change, not an invisible `fly secrets
// set`. See docs/architecture/01-overview.md decision #46.
//
// The enrichment agent's model/region/temperature live with its prompt in
// adapters/llm/agent-definitions/artifact-metadata-enrichment/enrichment_agent-config.ts, not
// here — those are the LLM call's own shape, not job-level orchestration policy. What's here is
// how the *worker* uses that agent, not how the agent itself is built.

/** Hard filter applied in code before any AI-proposed relationship is written — never left to
 * the model to self-regulate. See workers/handlers/artifactEnrich.ts. */
export const ENRICHMENT_RELATIONSHIP_CONFIDENCE_THRESHOLD = 0.75;

/** Bounds how many of the owner's other artifacts are considered as relationship candidates per
 * enrichment run (most recently published first). Truncation is logged, never silent. */
export const ENRICHMENT_MAX_CANDIDATE_ARTIFACTS = 50;

/** Caps how much of the primary artifact's text content is sent to the LLM. Distinct from
 * adapters/mcp/toolHelpers.ts's SMALL_CONTENT_MAX_BYTES, which bounds MCP tool-result size, not
 * prompt cost. */
export const ENRICHMENT_MAX_CONTENT_BYTES = 200_000;
