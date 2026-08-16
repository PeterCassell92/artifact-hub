import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GetStartedPage } from "./GetStartedPage";

describe("GetStartedPage", () => {
  it("shows the Claude Code CLI command with the /mcp URL", () => {
    render(<GetStartedPage />);
    expect(screen.getByText(/claude mcp add --transport http artifact-hub/)).toHaveTextContent("/mcp");
  });

  it("shows the Claude Desktop connector URL and config snippet", () => {
    render(<GetStartedPage />);
    expect(screen.getAllByText(/\/mcp/).length).toBeGreaterThan(0);
    expect(screen.getByText(/mcpServers/)).toBeInTheDocument();
  });

  it("copies a code block to the clipboard", async () => {
    render(<GetStartedPage />);
    const user = userEvent.setup();

    // Must come AFTER userEvent.setup() — it installs its own navigator.clipboard stub for
    // user.copy()/paste() support, which would otherwise clobber this override.
    const writeText = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const copyButtons = screen.getAllByRole("button", { name: /copy/i });
    await user.click(copyButtons[0]!);

    expect(writeText).toHaveBeenCalled();
    expect(await screen.findAllByText(/copied/i)).not.toHaveLength(0);
  });
});
