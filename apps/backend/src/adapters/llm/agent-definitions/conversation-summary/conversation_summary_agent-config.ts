import { z } from "zod";
import type { AgentConfig } from "../types";
import { conversationSummaryPrompt } from "./conversation_summary_prompt";

/** Values `conversation_summary_prompt.ts` is formatted with. */
export const ConversationSummaryPromptParams = z.object({
  artifactTitle: z.string(),
  /** The reduced (user/assistant text only) transcript — see `lib/claudeCodeTranscript.ts`'s
   * `ReducedTranscript.asText`, never the raw JSONL. */
  transcript: z.string(),
});
export type ConversationSummaryPromptParams = z.infer<typeof ConversationSummaryPromptParams>;

export const ConversationSummaryAgentOutput = z.object({
  conversationSummary: z
    .string()
    .describe(
      "2-4 short paragraphs separated by a blank line (\\n\\n) — never one dense block of prose: " +
        "what was requested, what was done, any distinct pivot/blocker, and how it concluded. Omit " +
        "any paragraph with nothing to say.",
    ),
});
export type ConversationSummaryAgentOutput = z.infer<typeof ConversationSummaryAgentOutput>;

/** No tools — a single-shot summarization over content already fully provided in the prompt,
 * nothing for the agent to go fetch. Same Claude Sonnet model as the enrichment agent; swapping
 * to a lighter model later is a one-line change here, nowhere else. */
export const conversationSummaryAgentConfig: AgentConfig<ConversationSummaryPromptParams, ConversationSummaryAgentOutput> = {
  model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  temperature: 0,
  prompt: conversationSummaryPrompt,
  promptParameters: ConversationSummaryPromptParams,
  outputSchema: ConversationSummaryAgentOutput,
};
