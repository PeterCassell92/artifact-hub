import { render, screen } from "@testing-library/react";
import { InfoTooltip } from "./InfoTooltip";

describe("InfoTooltip", () => {
  it("exposes the label via title and aria-label so hover and screen readers both work", () => {
    render(<InfoTooltip label="Expiry is relative to the published date" />);

    const button = screen.getByRole("button", { name: "Expiry is relative to the published date" });
    expect(button).toHaveAttribute("title", "Expiry is relative to the published date");
  });
});
