import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import type { CommentView } from "contracts";
import { makeStore } from "../store/store";
import { NotificationRegion } from "./NotificationRegion";

const unwrap = jest.fn<() => Promise<CommentView>>();
const addComment = jest.fn(() => ({ unwrap }));

// This project's Jest config runs true native ESM (--experimental-vm-modules), where static
// imports resolve before any module-body code — including a top-level `jest.mock()` — can run.
// `jest.unstable_mockModule` + a dynamic `import()` of the module under test (after registering
// the mock) is the documented ESM-mode replacement (see frontend-component-testing skill).
jest.unstable_mockModule("../store/api", () => ({
  useAddCommentMutation: () => [addComment, { isLoading: false }],
}));

const { CommentForm } = await import("./CommentForm");

function renderWithStore() {
  return render(
    <Provider store={makeStore()}>
      <NotificationRegion />
      <CommentForm artifactId="artifact-1" />
    </Provider>,
  );
}

describe("CommentForm", () => {
  beforeEach(() => {
    addComment.mockClear();
    unwrap.mockReset().mockResolvedValue({
      id: "c1",
      authorName: "Ada",
      body: "Nice!",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("submits the entered body for the given artifact", async () => {
    renderWithStore();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/add a comment/i), "Nice work!");
    await user.click(screen.getByRole("button", { name: /comment/i }));

    expect(addComment).toHaveBeenCalledWith({ artifactId: "artifact-1", body: "Nice work!" });
  });

  it("disables submit until there is a non-empty body", () => {
    renderWithStore();
    expect(screen.getByRole("button", { name: /comment/i })).toBeDisabled();
  });

  it("shows an in-DOM error notification when the submit fails", async () => {
    unwrap.mockReset().mockRejectedValue(new Error("boom"));
    renderWithStore();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/add a comment/i), "Nice work!");
    await user.click(screen.getByRole("button", { name: /comment/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to add comment/i);
  });
});
