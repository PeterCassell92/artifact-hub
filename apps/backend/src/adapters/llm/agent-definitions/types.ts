import type { ChatPromptTemplate } from "@langchain/core/prompts";
import type { z } from "zod";

/**
 * One tool an agent may call mid-reasoning. Only the static shape lives here (name/description/
 * schema, which is what the model needs to see and what `BedrockChatService` validates arguments
 * against) — the runtime handler that actually executes it is supplied by the caller of
 * `BedrockChatService.run()`, never by the agent definition itself. Agent definitions describe
 * *what an agent can ask for*; they never get DB/storage access of their own.
 */
export interface AgentToolDef {
  name: string;
  description: string;
  schema: z.ZodType<Record<string, unknown>>;
}

/**
 * A self-contained description of one Bedrock-backed agent — everything `BedrockChatService`
 * needs to run it, and nothing else. Adding a new agent means adding a new
 * `agent-definitions/<name>/` folder (a prompt + a config like this), not writing new
 * Bedrock-calling code — that machinery is generic and lives in `bedrockChatService.ts`.
 */
export interface AgentConfig<TPromptParams extends Record<string, unknown>, TOutput> {
  /** Bedrock model id (or cross-region inference profile). */
  model: string;
  /** Falls back to `BEDROCK_AWS_REGION` (env) if omitted — most agents don't need to override this. */
  region?: string;
  temperature?: number;
  /** The LangChain prompt this agent formats with `promptParameters` at call time. */
  prompt: ChatPromptTemplate;
  /** Documents *and* validates the values `prompt` expects to be interpolated with (e.g. the
   * enrichment agent's `primaryArtifactContent`/`candidateList`/`confidenceThreshold`) —
   * `BedrockChatService.run()` parses `params` against this before formatting the prompt, so a
   * caller/prompt mismatch fails fast instead of silently sending `{undefined}` to the model. */
  promptParameters: z.ZodType<TPromptParams>;
  /** The structured shape this agent's final answer must take. */
  outputSchema: z.ZodType<TOutput>;
  tools?: AgentToolDef[];
  /** Bounded so a confused model can't loop indefinitely. Default 4. */
  maxToolTurns?: number;
}
