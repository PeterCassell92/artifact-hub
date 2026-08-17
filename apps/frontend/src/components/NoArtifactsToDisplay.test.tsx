import { render, screen } from "@testing-library/react";
import { NoArtifactsToDisplay } from "./NoArtifactsToDisplay";

describe("NoArtifactsToDisplay", () => {
  it("renders the empty-state message", () => {
    render(<NoArtifactsToDisplay />);

    expect(screen.getByText("No artifacts to display")).toBeInTheDocument();
  });
});
