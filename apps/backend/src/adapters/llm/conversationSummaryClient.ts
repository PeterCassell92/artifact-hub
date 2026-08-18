export interface ProposeConversationSummaryInput {
  artifactTitle: string;
  /** The reduced (user/assistant text only) transcript — see `lib/claudeCodeTranscript.ts`. */
  transcript: string;
}

export interface ConversationSummaryResult {
  conversationSummary: string;
}

/** The LLM boundary for the conversation-summary agent — kept behind an interface so it's
 * stubbable in tests, same reasoning as `EnrichmentLlmClient` (docs/future-features/AI-features.md). */
export interface ConversationSummaryLlmClient {
  proposeConversationSummary(input: ProposeConversationSummaryInput): Promise<ConversationSummaryResult>;
}
