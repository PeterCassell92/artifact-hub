import type {
  ConversationSummaryLlmClient,
  ConversationSummaryResult,
  ProposeConversationSummaryInput,
} from "./conversationSummaryClient";

/** Test-only double for `ConversationSummaryLlmClient` — deterministic, no network call. Same
 * shape as `FakeEnrichmentClient`. */
export class FakeConversationSummaryClient implements ConversationSummaryLlmClient {
  constructor(
    private readonly options: {
      result?: ConversationSummaryResult;
      /** Throws instead of resolving, to exercise the worker's best-effort failure handling. */
      error?: Error;
    } = {},
  ) {}

  async proposeConversationSummary(input: ProposeConversationSummaryInput): Promise<ConversationSummaryResult> {
    if (this.options.error) throw this.options.error;
    return this.options.result ?? { conversationSummary: `Summary of the "${input.artifactTitle}" session.` };
  }
}
