import { render, screen } from "@testing-library/react";
import type { ArtifactTagView } from "contracts";
import { ArtifactTags } from "./ArtifactTags";

describe("ArtifactTags", () => {
  it("renders nothing when there are no tags", () => {
    const { container } = render(<ArtifactTags tags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a human tag without an AI badge", () => {
    const tags: ArtifactTagView[] = [{ name: "architecture", source: "human", confidence: null }];
    render(<ArtifactTags tags={tags} />);

    expect(screen.getByText("architecture")).toBeInTheDocument();
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
  });

  it("marks an AI-sourced tag with an AI badge and confidence tooltip", () => {
    const tags: ArtifactTagView[] = [{ name: "service mesh", source: "ai", confidence: 0.87 }];
    render(<ArtifactTags tags={tags} />);

    expect(screen.getByText("service mesh")).toBeInTheDocument();
    const badge = screen.getByText("AI");
    expect(badge).toBeInTheDocument();
    expect(badge.closest("li")).toHaveAttribute("title", expect.stringContaining("87%"));
  });
});
