import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RelationshipDraft } from "./RelationshipPicker";

jest.unstable_mockModule("./RelationshipPicker", () => ({
  RelationshipPicker: ({ onAdd }: { onAdd: (draft: RelationshipDraft) => void }) => (
    <button
      type="button"
      onClick={() => onAdd({ toId: "artifact-9", toTitle: "Source diagram", type: "supersedes" })}
    >
      Stub add relationship
    </button>
  ),
}));

const { PublishMetadataFields } = await import("./PublishMetadataFields");

function baseProps() {
  return {
    title: "",
    onTitleChange: jest.fn(),
    fileType: "PDF",
    kind: "other" as const,
    onKindChange: jest.fn(),
    tags: [],
    onTagsChange: jest.fn(),
    language: "en",
    onLanguageChange: jest.fn(),
    relationships: [] as RelationshipDraft[],
    onRelationshipsChange: jest.fn(),
  };
}

describe("PublishMetadataFields", () => {
  it("reports edits to name, kind, and language via their own callbacks", async () => {
    const props = baseProps();
    const user = userEvent.setup();
    render(<PublishMetadataFields {...props} />);

    await user.type(screen.getByLabelText(/^name$/i), "X");
    expect(props.onTitleChange).toHaveBeenLastCalledWith("X");

    await user.selectOptions(screen.getByLabelText(/^kind$/i), "diagram");
    expect(props.onKindChange).toHaveBeenCalledWith("diagram");

    await user.selectOptions(screen.getByLabelText(/^language$/i), "fr");
    expect(props.onLanguageChange).toHaveBeenCalledWith("fr");
  });

  it("shows the file type read-only, not as an editable field", () => {
    render(<PublishMetadataFields {...baseProps()} />);

    const fileType = screen.getByLabelText(/file type/i);
    expect(fileType).toHaveTextContent("PDF");
    expect(fileType.tagName).toBe("P");
    expect(screen.queryByRole("textbox", { name: /file type/i })).not.toBeInTheDocument();
  });

  it("does not render a source tool or format field — the SPA fixes sourceTool itself, and format doesn't exist as an artifact field", () => {
    render(<PublishMetadataFields {...baseProps()} />);

    expect(screen.queryByLabelText(/source tool/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^format$/i)).not.toBeInTheDocument();
  });

  it("only offers the fixed set of language options, defaulting to English", () => {
    render(<PublishMetadataFields {...baseProps()} />);

    const select = screen.getByLabelText(/^language$/i) as HTMLSelectElement;
    expect(select.value).toBe("en");
    expect(screen.getByRole("option", { name: "Spanish" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /language/i })).not.toBeInTheDocument();
  });

  it("adds a tag on Enter and removes it via its × button", async () => {
    const props = baseProps();
    const user = userEvent.setup();
    render(<PublishMetadataFields {...props} />);

    await user.type(screen.getByLabelText(/tags/i), "roadmap{enter}");
    expect(props.onTagsChange).toHaveBeenCalledWith(["roadmap"]);
  });

  it("does not add a duplicate or blank tag", async () => {
    const props = { ...baseProps(), tags: ["roadmap"] };
    const user = userEvent.setup();
    render(<PublishMetadataFields {...props} />);

    await user.type(screen.getByLabelText(/tags/i), "roadmap{enter}");
    expect(props.onTagsChange).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/tags/i), "{enter}");
    expect(props.onTagsChange).not.toHaveBeenCalled();
  });

  it("shows staged relationships and removes one by index", async () => {
    const props = {
      ...baseProps(),
      relationships: [{ toId: "artifact-2", toTitle: "Existing link", type: "related_to" as const }],
    };
    const user = userEvent.setup();
    render(<PublishMetadataFields {...props} />);

    expect(screen.getByText("Existing link")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove relationship to existing link/i }));
    expect(props.onRelationshipsChange).toHaveBeenCalledWith([]);
  });

  it("appends a relationship staged via the picker", async () => {
    const props = baseProps();
    const user = userEvent.setup();
    render(<PublishMetadataFields {...props} />);

    await user.click(screen.getByRole("button", { name: /stub add relationship/i }));

    expect(props.onRelationshipsChange).toHaveBeenCalledWith([
      { toId: "artifact-9", toTitle: "Source diagram", type: "supersedes" },
    ]);
  });
});
