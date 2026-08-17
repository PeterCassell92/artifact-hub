import { jest } from "@jest/globals";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ArtifactListResponse } from "contracts";
import type { RelationshipDraft } from "./RelationshipPicker";

function listResponse(items: ArtifactListResponse["items"]): ArtifactListResponse {
  return { items, nextCursor: null };
}

const MINE: ArtifactListResponse["items"] = [
  {
    id: "artifact-2",
    ownerId: "u1",
    title: "Q3 architecture diagram",
    fileName: "q3.mmd",
    contentType: "text/x-mermaid",
    kind: "diagram",
    sizeBytes: 100,
    publisherName: "Ada Lovelace",
    publishedAt: "2026-01-15T00:00:00.000Z",
    audienceType: "specific_users",
    expiresAt: null,
    isExpired: false,
    revoked: false,
    commentCount: 0,
  },
  {
    id: "artifact-1",
    ownerId: "u1",
    title: "Self",
    fileName: "self.txt",
    contentType: "text/plain",
    kind: "other",
    sizeBytes: 10,
    publisherName: "Ada Lovelace",
    publishedAt: "2026-01-15T00:00:00.000Z",
    audienceType: "specific_users",
    expiresAt: null,
    isExpired: false,
    revoked: false,
    commentCount: 0,
  },
];

const useGetMyArtifactsQuery = jest.fn<() => { data?: ArtifactListResponse }>();
const useGetSharedWithMeQuery = jest.fn<() => { data?: ArtifactListResponse }>();

jest.unstable_mockModule("../store/api", () => ({
  useGetMyArtifactsQuery: () => useGetMyArtifactsQuery(),
  useGetSharedWithMeQuery: () => useGetSharedWithMeQuery(),
}));

const { RelationshipPicker } = await import("./RelationshipPicker");

describe("RelationshipPicker", () => {
  beforeEach(() => {
    useGetMyArtifactsQuery.mockReturnValue({ data: listResponse(MINE) });
    useGetSharedWithMeQuery.mockReturnValue({ data: listResponse([]) });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("excludes the current artifact from results and lets the owner pick another", async () => {
    jest.useFakeTimers();
    const onAdd = jest.fn();
    const user = userEvent.setup({ delay: null });
    render(<RelationshipPicker excludeArtifactId="artifact-1" onAdd={onAdd} />);

    await user.type(screen.getByLabelText(/search artifacts to link/i), "diagram");
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(screen.getByText("Q3 architecture diagram")).toBeInTheDocument();
    expect(screen.queryByText("Self")).not.toBeInTheDocument();
  });

  it("selecting a result reveals type/note fields, and Add calls onAdd with the draft", async () => {
    const onAdd = jest.fn<(draft: RelationshipDraft) => void>();
    const user = userEvent.setup();
    render(<RelationshipPicker onAdd={onAdd} />);

    await user.click(screen.getByRole("radio", { name: "Q3 architecture diagram" }));
    await user.selectOptions(screen.getByLabelText(/relationship type/i), "derived_from");
    await user.type(screen.getByLabelText(/note/i), "compiled export");
    await user.click(screen.getByRole("button", { name: /add relationship/i }));

    expect(onAdd).toHaveBeenCalledWith({
      toId: "artifact-2",
      toTitle: "Q3 architecture diagram",
      type: "derived_from",
      note: "compiled export",
    });
  });

  it("switches to Shared With Me results when that scope is chosen", async () => {
    useGetSharedWithMeQuery.mockReturnValue({
      data: listResponse([{ ...MINE[0]!, id: "artifact-5", title: "Someone else's report" }]),
    });
    const user = userEvent.setup();
    render(<RelationshipPicker onAdd={jest.fn()} />);

    await user.selectOptions(screen.getByLabelText(/search scope/i), "sharedWithMe");

    expect(screen.getByText("Someone else's report")).toBeInTheDocument();
  });
});
