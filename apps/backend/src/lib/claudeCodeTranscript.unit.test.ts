import { isClaudeCodeTranscriptContentType, reduceClaudeCodeTranscript } from "./claudeCodeTranscript";

/** Mirrors the real line shapes found in an actual Claude Code session log (redacted/shrunk). */
const TRANSCRIPT_LINES = [
  { type: "queue-operation", operation: "enqueue", timestamp: "2026-08-17T12:28:32.401Z" },
  {
    type: "user",
    timestamp: "2026-08-17T12:28:32.489Z",
    message: {
      role: "user",
      content: [
        { type: "text", text: "Fix the email domain authentication issue." },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aHVnZS1iYXNlNjQtYmxvYg==" } },
      ],
    },
  },
  {
    type: "attachment",
    attachment: { type: "deferred_tools_delta", addedNames: ["Read", "Write", "Bash"] },
  },
  { type: "file-history-snapshot", messageId: "abc", snapshot: { trackedFileBackups: {} } },
  {
    type: "assistant",
    timestamp: "2026-08-17T12:28:36.694Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "opaque-signature-blob" },
        { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/foo.txt" } },
        { type: "text", text: "I've fixed the DMARC record and updated the SPF entry." },
      ],
    },
  },
  { type: "last-prompt", lastPrompt: "Fix the email domain authentication issue.", sessionId: "s1" },
  { type: "ai-title", aiTitle: "Fix email domain authentication", sessionId: "s1" },
  // A tool-result turn arrives as a "user"-typed line with no text block — should contribute
  // nothing, including to the timestamp range, even though its own timestamp (12:29:00) is later
  // than every real turn's — proves the exclusion applies to timestamps too, not just text.
  {
    type: "user",
    timestamp: "2026-08-17T12:29:00.000Z",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "file contents" }] },
  },
  // Plain-string message.content form (also valid per the Claude API shape).
  { type: "user", timestamp: "2026-08-17T12:28:40.000Z", message: { role: "user", content: "Thanks, that worked." } },
];

const REAL_TRANSCRIPT_JSONL = TRANSCRIPT_LINES.map((l) => JSON.stringify(l)).join("\n");

describe("reduceClaudeCodeTranscript", () => {
  it("keeps only user/assistant text content, dropping images, thinking, tool_use, tool_result, and bookkeeping lines", () => {
    const result = reduceClaudeCodeTranscript(REAL_TRANSCRIPT_JSONL);

    expect(result.turns).toEqual([
      { role: "user", text: "Fix the email domain authentication issue." },
      { role: "assistant", text: "I've fixed the DMARC record and updated the SPF entry." },
      { role: "user", text: "Thanks, that worked." },
    ]);
  });

  it("marks a transcript with real back-and-forth as a conversation", () => {
    expect(reduceClaudeCodeTranscript(REAL_TRANSCRIPT_JSONL).isConversation).toBe(true);
  });

  it("formats asText as USER:/ASSISTANT: blocks in order", () => {
    const { asText } = reduceClaudeCodeTranscript(REAL_TRANSCRIPT_JSONL);
    expect(asText).toBe(
      "USER: Fix the email domain authentication issue.\n\n" +
        "ASSISTANT: I've fixed the DMARC record and updated the SPF entry.\n\n" +
        "USER: Thanks, that worked.",
    );
  });

  it("does not treat a JSONL file with fewer than two real turns as a conversation", () => {
    const oneTurn = JSON.stringify({ type: "user", message: { role: "user", content: "hello" } });
    expect(reduceClaudeCodeTranscript(oneTurn).isConversation).toBe(false);

    const noTurns = [
      JSON.stringify({ type: "queue-operation", operation: "enqueue" }),
      JSON.stringify({ id: 1, event: "something" }), // some other JSONL data file shape entirely
    ].join("\n");
    const result = reduceClaudeCodeTranscript(noTurns);
    expect(result.isConversation).toBe(false);
    expect(result.turns).toEqual([]);
    expect(result.asText).toBe("");
  });

  it("skips unparseable lines instead of throwing", () => {
    const withGarbage = ["not json at all", REAL_TRANSCRIPT_JSONL].join("\n");
    expect(() => reduceClaudeCodeTranscript(withGarbage)).not.toThrow();
    expect(reduceClaudeCodeTranscript(withGarbage).turns).toHaveLength(3);
  });

  it("extracts the earliest/latest timestamp among real turns only, ignoring excluded lines' timestamps", () => {
    const result = reduceClaudeCodeTranscript(REAL_TRANSCRIPT_JSONL);
    // 12:28:32.489 (first user) .. 12:28:40.000 (final "Thanks") — NOT the excluded tool_result
    // line's 12:29:00, which is later than every real turn.
    expect(result.firstMessageDateTime).toBe("2026-08-17T12:28:32.489Z");
    expect(result.finalMessageDateTime).toBe("2026-08-17T12:28:40.000Z");
  });

  it("reports messageCount as the number of real turns, excluding tool-result-only lines", () => {
    // 3 real turns: first user text, assistant text, final "Thanks" user — the tool_result-only
    // user line contributes nothing, same as it contributes no text/timestamp.
    expect(reduceClaudeCodeTranscript(REAL_TRANSCRIPT_JSONL).messageCount).toBe(3);
  });

  it("returns null timestamps when no turn carries a parseable one", () => {
    const noTimestamps = [
      JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "hello" } }),
    ].join("\n");
    const result = reduceClaudeCodeTranscript(noTimestamps);
    expect(result.firstMessageDateTime).toBeNull();
    expect(result.finalMessageDateTime).toBeNull();
  });

  it("ignores an unparseable timestamp rather than throwing or corrupting the range", () => {
    const badTimestamp = [
      JSON.stringify({ type: "user", timestamp: "not-a-date", message: { role: "user", content: "hi" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-08-17T12:00:00.000Z", message: { role: "assistant", content: "hello" } }),
    ].join("\n");
    const result = reduceClaudeCodeTranscript(badTimestamp);
    expect(result.firstMessageDateTime).toBe("2026-08-17T12:00:00.000Z");
    expect(result.finalMessageDateTime).toBe("2026-08-17T12:00:00.000Z");
  });
});

describe("isClaudeCodeTranscriptContentType", () => {
  it.each(["application/jsonl", "application/x-ndjson", "application/x-jsonlines"])(
    "recognizes %s",
    (contentType) => {
      expect(isClaudeCodeTranscriptContentType(contentType)).toBe(true);
    },
  );

  it.each(["application/json", "text/plain", "application/octet-stream"])("does not recognize %s", (contentType) => {
    expect(isClaudeCodeTranscriptContentType(contentType)).toBe(false);
  });
});
