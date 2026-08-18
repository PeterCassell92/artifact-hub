import { ChatPromptTemplate } from "@langchain/core/prompts";

/**
 * The conversation-summary agent's prompt — distinct from `enrichment_prompt.ts`'s generic
 * document-summarization framing, purpose-built for a *reduced* transcript (tool calls/results
 * already stripped by `lib/claudeCodeTranscript.ts` — only what the user asked and what the
 * assistant said remains). Interpolated with `ConversationSummaryPromptParams` (see
 * `conversation_summary_agent-config.ts`).
 */
export const conversationSummaryPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are given a reduced transcript of a coding-agent working session, titled "{artifactTitle}". ` +
      `Tool calls and their results have already been stripped out — you are only shown what the ` +
      `human asked for and what the assistant said back, in order. Write for someone skimming a ` +
      `list of past sessions to find one again — be concrete about the subject matter, not generic ` +
      `("helped the user with their code").\n\n` +
      `Structure the summary as 2-4 short paragraphs, separated by a blank line (two newlines) ` +
      `between each — never one dense block of prose. Roughly:\n` +
      `1. What was requested/discussed — the human's goal(s), in their own terms where possible.\n` +
      `2. What was actually done or decided — be specific (file/feature/bug names, not "various changes").\n` +
      `3. If the session had a distinct turn (a pivot in scope, a blocker, a follow-up request), its ` +
      `own paragraph.\n` +
      `4. How it concluded — resolved and verified, still open, blocked on something, or handed off.\n` +
      `Omit any paragraph that has nothing to say rather than padding it out.`,
  ],
  ["human", "{transcript}"],
]);
