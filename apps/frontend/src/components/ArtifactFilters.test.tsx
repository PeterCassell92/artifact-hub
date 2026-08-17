import { jest } from "@jest/globals";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ArtifactFacetOptions } from "contracts";
import type { ArtifactListFilters } from "../store/api";
import { ArtifactFilters } from "./ArtifactFilters";

const FACETS: ArtifactFacetOptions = {
  contentTypes: ["application/pdf", "image/png"],
  tags: ["roadmap"],
  sourceTools: ["Claude Desktop"],
  publishers: [{ id: "user-1", name: "Ada Lovelace" }],
};

function renderFilters(
  scope: "mine" | "sharedWithMe",
  value: ArtifactListFilters,
  onChange: (next: ArtifactListFilters) => void,
  facets?: ArtifactFacetOptions,
) {
  return render(<ArtifactFilters scope={scope} value={value} onChange={onChange} facets={facets} />);
}

describe("ArtifactFilters", () => {
  it("debounces the search box and calls onChange with the trimmed q", async () => {
    jest.useFakeTimers();
    const onChange = jest.fn();
    const user = userEvent.setup({ delay: null });
    renderFilters("mine", { sort: "published" }, onChange);

    await user.type(screen.getByLabelText(/search/i), "roadmap");
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(onChange).toHaveBeenCalledWith({ sort: "published", q: "roadmap" });
    jest.useRealTimers();
  });

  it("changing sort calls onChange immediately with the new sort", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderFilters("mine", { sort: "published" }, onChange);

    await user.selectOptions(screen.getByLabelText(/sort/i), "title");

    expect(onChange).toHaveBeenCalledWith({ sort: "title" });
  });

  it("toggling a Kind checkbox adds it to the kind filter", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderFilters("mine", { sort: "published" }, onChange);

    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.click(screen.getByRole("checkbox", { name: /diagram/i }));

    expect(onChange).toHaveBeenCalledWith({ sort: "published", kind: ["diagram"] });
  });

  it("unchecking a selected Kind checkbox removes it", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderFilters("mine", { sort: "published", kind: ["diagram", "document"] }, onChange);

    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.click(screen.getByRole("checkbox", { name: /diagram/i }));

    expect(onChange).toHaveBeenCalledWith({ sort: "published", kind: ["document"] });
  });

  it("shows a badge with the number of active facet filters and clears on outside click/Escape", async () => {
    const user = userEvent.setup();
    renderFilters("mine", { sort: "published", kind: ["diagram", "document"], tags: ["v1"] }, jest.fn(), FACETS);

    const filtersButton = screen.getByRole("button", { name: /filters/i });
    expect(filtersButton).toHaveTextContent("3");

    await user.click(filtersButton);
    expect(screen.getByRole("group", { name: /filters/i })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: /filters/i })).not.toBeInTheDocument();
  });

  it("shows Audience and Access state controls for scope=mine, not Publisher/Shared window", async () => {
    const user = userEvent.setup();
    renderFilters("mine", { sort: "published" }, jest.fn(), FACETS);
    await user.click(screen.getByRole("button", { name: /filters/i }));

    expect(screen.getByText(/audience/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access state/i)).toBeInTheDocument();
    expect(screen.queryByText(/publisher/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/shared window/i)).not.toBeInTheDocument();
  });

  it("shows Publisher and Shared window controls for scope=sharedWithMe, not Audience/Access state", async () => {
    const user = userEvent.setup();
    renderFilters("sharedWithMe", { sort: "published" }, jest.fn(), FACETS);
    await user.click(screen.getByRole("button", { name: /filters/i }));

    expect(screen.getByText(/publisher/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/shared window/i)).toBeInTheDocument();
    expect(screen.queryByText(/audience/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/access state/i)).not.toBeInTheDocument();
  });

  it("selecting a Publisher checkbox (labeled by name) sets publisherId to their id", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderFilters("sharedWithMe", { sort: "published" }, onChange, FACETS);

    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.click(screen.getByRole("checkbox", { name: "Ada Lovelace" }));

    expect(onChange).toHaveBeenCalledWith({ sort: "published", publisherId: ["user-1"] });
  });

  it("does not render facet-derived checkbox groups until facets are loaded", async () => {
    const user = userEvent.setup();
    renderFilters("mine", { sort: "published" }, jest.fn());
    await user.click(screen.getByRole("button", { name: /filters/i }));

    expect(screen.queryByText(/file type/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tags/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/source tool/i)).not.toBeInTheDocument();
  });
});
