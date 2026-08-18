import { render, screen } from "@testing-library/react";
import { ConversationSummary } from "./ConversationSummary";

describe("ConversationSummary", () => {
  it("renders the summary text under a Conversation Summary heading", () => {
    render(<ConversationSummary summary="Fixed the DMARC record and updated the SPF entry." />);

    expect(screen.getByText("Conversation Summary")).toBeInTheDocument();
    expect(screen.getByText("Fixed the DMARC record and updated the SPF entry.")).toBeInTheDocument();
  });

  it("omits the byline entirely when no participants are given (today's Claude Code transcripts)", () => {
    render(<ConversationSummary summary="A two-party session summary." />);

    expect(screen.queryByText(/between/i)).not.toBeInTheDocument();
  });

  it("shows a two-party byline when participants are given", () => {
    render(
      <ConversationSummary
        summary="Discussed the release plan."
        participants={[{ name: "Ada Lovelace", role: "human" }, { name: "Claude", role: "agent" }]}
      />,
    );

    expect(screen.getByText("Between Ada Lovelace (human), Claude (agent)")).toBeInTheDocument();
  });

  it("scales to more than two participants without special-casing (e.g. a group chat)", () => {
    render(
      <ConversationSummary
        summary="The team agreed on the migration timeline."
        participants={[{ name: "Ada" }, { name: "Grace" }, { name: "Bob" }, { name: "Claude", role: "agent" }]}
      />,
    );

    expect(screen.getByText("Between Ada, Grace, Bob, Claude (agent)")).toBeInTheDocument();
  });

  it("shows message count and the first–final message range when both are given", () => {
    render(
      <ConversationSummary
        summary="Fixed the DMARC record."
        messageCount={3}
        firstMessageDateTime="2026-08-17T12:28:32.489Z"
        finalMessageDateTime="2026-08-17T12:28:40.000Z"
      />,
    );

    expect(screen.getByText(/3 messages/)).toBeInTheDocument();
    expect(screen.getByText(/–/)).toBeInTheDocument();
  });

  it("shows singular 'message' for a count of exactly one", () => {
    render(<ConversationSummary summary="A short exchange." messageCount={1} />);
    expect(screen.getByText("1 message")).toBeInTheDocument();
  });

  it("collapses the range to a single timestamp when first and final are identical", () => {
    render(
      <ConversationSummary
        summary="A one-shot exchange."
        firstMessageDateTime="2026-08-17T12:28:32.489Z"
        finalMessageDateTime="2026-08-17T12:28:32.489Z"
      />,
    );

    expect(screen.queryByText(/–/)).not.toBeInTheDocument();
  });

  it("omits the meta line entirely when no count or timestamps are given", () => {
    render(<ConversationSummary summary="No metadata available." />);
    expect(screen.queryByText(/message/)).not.toBeInTheDocument();
  });

  it("renders each blank-line-separated paragraph as its own paragraph element", () => {
    const summary = "First paragraph about the request.\n\nSecond paragraph about what was done.\n\nThird paragraph about the outcome.";
    render(<ConversationSummary summary={summary} />);

    const first = screen.getByText("First paragraph about the request.");
    const second = screen.getByText("Second paragraph about what was done.");
    const third = screen.getByText("Third paragraph about the outcome.");
    expect(first.tagName).toBe("P");
    expect(second.tagName).toBe("P");
    expect(third.tagName).toBe("P");
    expect(first).not.toBe(second);
  });

  it("renders a single-paragraph summary (no blank-line breaks) as one paragraph", () => {
    render(<ConversationSummary summary="Just one paragraph, no breaks." />);
    expect(screen.getByText("Just one paragraph, no breaks.").tagName).toBe("P");
  });
});
