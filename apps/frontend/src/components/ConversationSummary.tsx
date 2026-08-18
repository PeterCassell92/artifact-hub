import { formatPublishedAtWithTime, splitIntoParagraphs } from "../lib/formatters";

export interface ConversationParticipant {
  /** Display name or handle — e.g. "Ada Lovelace", "Claude", or a Slack handle. */
  name: string;
  /** Optional free-form role label (e.g. "human", "agent") — shown as a small qualifier, not
   * used to drive any layout/branching logic, so an arbitrary number of distinct roles (a group
   * chat with several humans and an agent, say) renders the same way as a single human+agent pair. */
  role?: string;
}

export interface ConversationSummaryProps {
  summary: string;
  /**
   * Optional — not every conversationSummary source can name its participants (today's Claude
   * Code transcripts only distinguish "user"/"assistant" roles, not named individuals, so this is
   * always omitted for those). Deliberately a list rather than a fixed "user"/"assistant" pair, so
   * a future source with more than two participants (a group chat export, say) renders without
   * this component needing a redesign.
   */
  participants?: ConversationParticipant[];
  /** Deterministic facts (never LLM-derived) — a rough sense of when the conversation took place
   * and how long it was. All independently optional: a source that can count messages but not
   * date them (or vice versa) still renders whatever it has. */
  messageCount?: number | null;
  firstMessageDateTime?: string | null;
  finalMessageDateTime?: string | null;
}

function formatMessageRange(first?: string | null, final?: string | null): string | null {
  if (first && final) {
    return first === final
      ? formatPublishedAtWithTime(first)
      : `${formatPublishedAtWithTime(first)} – ${formatPublishedAtWithTime(final)}`;
  }
  return first ? formatPublishedAtWithTime(first) : final ? formatPublishedAtWithTime(final) : null;
}

/** Renders an AI-generated summary of a conversation-shaped artifact (docs/architecture/01
 * decision #46 addendum) — used both on the artifact detail page's main content area (wherever
 * `artifact.conversationSummary` is present) and inside `EnrichmentPanel`'s per-run history, so
 * the two locations render the same summary identically rather than one being a stripped-down
 * copy of the other. The agent is prompted to separate its summary into paragraphs on blank
 * lines (`conversation_summary_prompt.ts`); `splitIntoParagraphs` renders each as its own `<p>`
 * since a single `<p>` collapses that whitespace. */
export function ConversationSummary({
  summary,
  participants,
  messageCount,
  firstMessageDateTime,
  finalMessageDateTime,
}: ConversationSummaryProps) {
  const messageRange = formatMessageRange(firstMessageDateTime, finalMessageDateTime);
  const metaParts = [
    messageCount != null ? `${messageCount} message${messageCount === 1 ? "" : "s"}` : null,
    messageRange,
  ].filter((part): part is string => part !== null);

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Conversation Summary</h2>
      {participants && participants.length > 0 && (
        <p className="mt-1 text-xs text-neutral-500">
          Between {participants.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(", ")}
        </p>
      )}
      {metaParts.length > 0 && <p className="mt-1 text-xs text-neutral-500">{metaParts.join(" · ")}</p>}
      <div className="mt-1 flex flex-col gap-2">
        {splitIntoParagraphs(summary).map((paragraph, i) => (
          <p key={i} className="text-neutral-800">
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
}
