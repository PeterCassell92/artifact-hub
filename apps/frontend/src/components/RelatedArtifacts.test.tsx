import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { ArtifactRelationshipSummary } from "contracts";
import { makeStore } from "../store/store";
import { NotificationRegion } from "./NotificationRegion";
import type { RelationshipDraft } from "./RelationshipPicker";

const useGetRelationshipsQuery = jest.fn<() => { isLoading: boolean; data?: ArtifactRelationshipSummary[] }>();
const createUnwrap = jest.fn<() => Promise<{ relationshipId: string; createdAt: string }>>();
const createRelationship = jest.fn(() => ({ unwrap: createUnwrap }));
const deleteUnwrap = jest.fn<() => Promise<void>>();
const deleteRelationship = jest.fn(() => ({ unwrap: deleteUnwrap }));

jest.unstable_mockModule("../store/api", () => ({
  useGetRelationshipsQuery: () => useGetRelationshipsQuery(),
  useCreateRelationshipMutation: () => [createRelationship, { isLoading: false }],
  useDeleteRelationshipMutation: () => [deleteRelationship, { isLoading: false }],
}));

// RelationshipPicker's own search/select behavior is covered by RelationshipPicker.test.tsx —
// stub it here to a single "Add" button so these tests stay focused on RelatedArtifacts' own
// wiring (remove-button visibility, calling the mutations, notifications).
jest.unstable_mockModule("./RelationshipPicker", () => ({
  RelationshipPicker: ({ onAdd }: { onAdd: (draft: RelationshipDraft) => void }) => (
    <button
      type="button"
      onClick={() => onAdd({ toId: "artifact-9", toTitle: "Picked artifact", type: "related_to" })}
    >
      Stub add relationship
    </button>
  ),
}));

const { RelatedArtifacts } = await import("./RelatedArtifacts");

function renderWithStore(canManagePolicy: boolean) {
  return render(
    <Provider store={makeStore()}>
      <NotificationRegion />
      <MemoryRouter>
        <RelatedArtifacts artifactId="artifact-1" canManagePolicy={canManagePolicy} />
      </MemoryRouter>
    </Provider>,
  );
}

const outgoing: ArtifactRelationshipSummary = {
  id: "r1",
  type: "derived_from",
  direction: "outgoing",
  note: "rendered PNG export",
  otherArtifact: { id: "artifact-2", title: "Q3 architecture diagram", kind: "diagram", ownerId: "u1" },
  createdByName: "Ada Lovelace",
  createdAt: "2026-01-15T00:00:00.000Z",
  source: "human",
  confidence: null,
};

const incoming: ArtifactRelationshipSummary = {
  id: "r2",
  type: "related_to",
  direction: "incoming",
  note: null,
  otherArtifact: null,
  createdByName: "Ada Lovelace",
  createdAt: "2026-01-15T00:00:00.000Z",
  source: "human",
  confidence: null,
};

describe("RelatedArtifacts", () => {
  beforeEach(() => {
    createRelationship.mockClear();
    createUnwrap.mockReset().mockResolvedValue({ relationshipId: "r3", createdAt: "2026-01-16T00:00:00.000Z" });
    deleteRelationship.mockClear();
    deleteUnwrap.mockReset().mockResolvedValue(undefined);
  });

  it("shows a visible relationship's type, linked title, and note", () => {
    useGetRelationshipsQuery.mockReturnValue({ isLoading: false, data: [outgoing] });

    renderWithStore(false);

    expect(screen.getByText("Derived from")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Q3 architecture diagram" });
    expect(link).toHaveAttribute("href", "/artifacts/artifact-2");
    expect(screen.getByText("rendered PNG export")).toBeInTheDocument();
  });

  it("redacts a relationship whose other side isn't viewable", () => {
    useGetRelationshipsQuery.mockReturnValue({ isLoading: false, data: [incoming] });

    renderWithStore(false);

    expect(screen.getByText(/restricted artifact/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no relationships", () => {
    useGetRelationshipsQuery.mockReturnValue({ isLoading: false, data: [] });

    renderWithStore(false);

    expect(screen.getByText(/no related artifacts/i)).toBeInTheDocument();
  });

  it("hides remove buttons and the picker for a non-owner", () => {
    useGetRelationshipsQuery.mockReturnValue({ isLoading: false, data: [outgoing] });

    renderWithStore(false);

    expect(screen.queryByRole("button", { name: /remove relationship/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stub add relationship/i })).not.toBeInTheDocument();
  });

  it("owner: shows a remove button on an outgoing relationship, and removing it calls deleteRelationship", async () => {
    useGetRelationshipsQuery.mockReturnValue({ isLoading: false, data: [outgoing] });
    renderWithStore(true);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /remove relationship/i }));

    expect(deleteRelationship).toHaveBeenCalledWith({ artifactId: "artifact-1", relationshipId: "r1" });
  });

  it("owner: does NOT show a remove button on an incoming relationship — the other side owns it", () => {
    useGetRelationshipsQuery.mockReturnValue({ isLoading: false, data: [incoming] });

    renderWithStore(true);

    expect(screen.queryByRole("button", { name: /remove relationship/i })).not.toBeInTheDocument();
  });

  it("owner: adding via the picker calls createRelationship with the artifact id", async () => {
    useGetRelationshipsQuery.mockReturnValue({ isLoading: false, data: [] });
    renderWithStore(true);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /stub add relationship/i }));

    expect(createRelationship).toHaveBeenCalledWith({
      artifactId: "artifact-1",
      toId: "artifact-9",
      type: "related_to",
      note: undefined,
    });
    expect(await screen.findByText(/linked to "picked artifact"/i)).toBeInTheDocument();
  });
});
