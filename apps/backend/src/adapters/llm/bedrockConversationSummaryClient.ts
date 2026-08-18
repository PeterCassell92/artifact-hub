import { BedrockChatService } from "./bedrockChatService";
import { conversationSummaryAgentConfig } from "./agent-definitions/conversation-summary/conversation_summary_agent-config";
import type { ConversationSummaryLlmClient, ConversationSummaryResult, ProposeConversationSummaryInput } from "./conversationSummaryClient";

const chatService = new BedrockChatService();

/** Real implementation — thin bridge from `ConversationSummaryLlmClient`'s port onto the
 * `conversation-summary` agent definition via the shared `BedrockChatService`, same pattern as
 * `BedrockEnrichmentClient`. */
export class BedrockConversationSummaryClient implements ConversationSummaryLlmClient {
  async proposeConversationSummary(input: ProposeConversationSummaryInput): Promise<ConversationSummaryResult> {
    return chatService.run(conversationSummaryAgentConfig, {
      artifactTitle: input.artifactTitle,
      transcript: input.transcript,
    });
  }
}
