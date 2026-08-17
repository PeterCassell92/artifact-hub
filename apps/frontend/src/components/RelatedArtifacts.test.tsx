import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { ArtifactRelationshipSummary } from "contracts";
import { makeStore } from "../store/store";

const useGetRelationshipsQuery = jest.fn<() => { isLoading: boolean; data?: ArtifactRelationshipSummary[] }>();
jest.unstable_mockModule("../store/api", () => ({
  useGetRelationshipsQuery: () => useGetRelationshipsQuery(),
}));

const { RelatedArtifacts } = await import("./RelatedArtifacts");

function renderWithStore() {
  return render(
    <Provider store={makeStore()}>
      <MemoryRouter>
        <RelatedArtifacts artifactId="artifact-1" />
      </MemoryRouter>
    </Provider>,
  );
}

describe("RelatedArtifacts", () => {
  it("shows a visible relationship's type, linked title, and note", () => {
    useGetRelationshipsQuery.mockReturnValue({
      isLoading: false,
      data: [
        {
          id: "r1",
          type: "derived_from",
          direction: "outgoing",
          note: "rendered PNG export",
          otherArtifact: { id: "artifact-2", title: "Q3 architecture diagram", kind: "diagram", ownerId: "u1" },
          createdByName: "Ada Lovelace",
          createdAt: "2026-01-15T00:00:00.000Z",
        },
      ],
    });

    renderWithStore();

    expect(screen.getByText("Derived from")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Q3 architecture diagram" });
    expect(link).toHaveAttribute("href", "/artifacts/artifact-2");
    expect(screen.getByText("rendered PNG export")).toBeInTheDocument();
  });

  it("redacts a relationship whose other side isn't viewable", () => {
    useGetRelationshipsQuery.mockReturnValue({
      isLoading: false,
      data: [
        {
          id: "r2",
          type: "related_to",
          direction: "incoming",
          note: null,
          otherArtifact: null,
          createdByName: "Ada Lovelace",
          createdAt: "2026-01-15T00:00:00.000Z",
        },
      ],
    });

    renderWithStore();

    expect(screen.getByText(/restricted artifact/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no relationships", () => {
    useGetRelationshipsQuery.mockReturnValue({ isLoading: false, data: [] });

    renderWithStore();

    expect(screen.getByText(/no related artifacts/i)).toBeInTheDocument();
  });
});
