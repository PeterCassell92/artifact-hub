import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import type { CommentView } from "contracts";
import { makeStore } from "../store/store";

const useGetCommentsQuery = jest.fn<() => { isLoading: boolean; data?: CommentView[] }>();
jest.unstable_mockModule("../store/api", () => ({
  useGetCommentsQuery: () => useGetCommentsQuery(),
}));

const { CommentList } = await import("./CommentList");

function renderWithStore() {
  return render(
    <Provider store={makeStore()}>
      <CommentList artifactId="artifact-1" />
    </Provider>,
  );
}

describe("CommentList", () => {
  it("shows each comment's body, author name, and date", () => {
    useGetCommentsQuery.mockReturnValue({
      isLoading: false,
      data: [
        { id: "c1", authorName: "Ada Lovelace", body: "Great work!", createdAt: "2026-01-15T00:00:00.000Z" },
      ],
    });

    renderWithStore();

    expect(screen.getByText("Great work!")).toBeInTheDocument();
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
    expect(screen.getByText(/Jan 15, 2026/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no comments", () => {
    useGetCommentsQuery.mockReturnValue({ isLoading: false, data: [] });

    renderWithStore();

    expect(screen.getByText(/no comments yet/i)).toBeInTheDocument();
  });
});
