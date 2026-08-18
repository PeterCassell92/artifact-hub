/** JSONL content types this module knows how to reduce — the same variants
 * `lib/contentType.ts`'s `isTextLike`/`inferContentType` already recognize as JSONL. */
export function isClaudeCodeTranscriptContentType(contentType: string): boolean {
  return (
    contentType === "application/jsonl" ||
    contentType === "application/x-ndjson" ||
    contentType === "application/x-jsonlines"
  );
}

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ReducedTranscript {
  isConversation: boolean;
  turns: ConversationTurn[];
  /** "USER: ...\n\nASSISTANT: ...\n\n..." — ready to inject directly into a prompt. */
  asText: string;
  /** `turns.length` — pulled out as its own field (rather than leaving callers to read
   * `turns.length` themselves) since it's a persisted fact alongside the two timestamps below, not
   * just an implementation detail of `turns`. */
  messageCount: number;
  /** ISO timestamps of the earliest/latest recognized turn (both `user` and `assistant` lines
   * carry a top-level `timestamp` in the real transcript format) — null when no turn carried a
   * parseable one. Deterministic, not LLM-derived: the model never sees or invents these. */
  firstMessageDateTime: string | null;
  finalMessageDateTime: string | null;
}

interface TranscriptContentBlock {
  type?: string;
  text?: string;
}

interface TranscriptLine {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: string | TranscriptContentBlock[];
  };
}

function textFromContent(content: string | TranscriptContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n")
    .trim();
}

/** Parses `timestamp` defensively — a malformed or missing value should never break reduction,
 * just fail to contribute to the first/final message range. */
function parseTimestamp(timestamp: string | undefined): Date | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Deterministically reduces a Claude Code session log (JSONL, one JSON object per line) down to
 * just the user/assistant conversational text — dropping `image` blocks (can be hundreds of KB of
 * base64 per line), `thinking`/`tool_use` blocks, `tool_result` blocks (nested inside `user`-typed
 * lines in Claude API format), and non-conversational line types entirely
 * (`queue-operation`/`attachment`/`file-history-snapshot`/`last-prompt`/`ai-title`). The original
 * artifact in storage is never touched — this only shapes what gets sent to an LLM for enrichment.
 *
 * Also extracts the earliest/latest turn timestamps, giving a rough sense of when the
 * conversation took place without needing the LLM to infer or report it.
 *
 * Unparseable lines are skipped, not thrown on — a transcript with a few corrupted lines should
 * still reduce to whatever readable content it has, not fail outright.
 */
export function reduceClaudeCodeTranscript(rawJsonl: string): ReducedTranscript {
  const turns: ConversationTurn[] = [];
  let firstMessageDate: Date | null = null;
  let finalMessageDate: Date | null = null;

  for (const line of rawJsonl.split("\n")) {
    if (!line.trim()) continue;

    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed.type !== "user" && parsed.type !== "assistant") continue;

    const text = textFromContent(parsed.message?.content);
    if (!text) continue;

    turns.push({ role: parsed.type, text });

    const date = parseTimestamp(parsed.timestamp);
    if (date) {
      if (!firstMessageDate || date < firstMessageDate) firstMessageDate = date;
      if (!finalMessageDate || date > finalMessageDate) finalMessageDate = date;
    }
  }

  return {
    // A minimum-substance threshold — a JSONL file that merely happens to contain one line with
    // type "user" by coincidence shouldn't be misclassified as a recognized conversation.
    isConversation: turns.length >= 2,
    turns,
    asText: turns.map((t) => `${t.role.toUpperCase()}: ${t.text}`).join("\n\n"),
    messageCount: turns.length,
    firstMessageDateTime: firstMessageDate?.toISOString() ?? null,
    finalMessageDateTime: finalMessageDate?.toISOString() ?? null,
  };
}
