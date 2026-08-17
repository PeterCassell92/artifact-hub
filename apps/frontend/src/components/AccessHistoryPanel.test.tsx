import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import type { AccessEventListResponse } from "contracts";
import { makeStore } from "../store/store";

const useGetAccessEventsQuery =
  jest.fn<
    (args: { artifactId: string; cursor?: string }) => {
      isLoading: boolean;
      isFetching: boolean;
      data?: AccessEventListResponse;
    }
  >();
jest.unstable_mockModule("../store/api", () => ({
  useGetAccessEventsQuery: (args: { artifactId: string; cursor?: string }) => useGetAccessEventsQuery(args),
}));

const { AccessHistoryPanel } = await import("./AccessHistoryPanel");

function renderWithStore() {
  return render(
    <Provider store={makeStore()}>
      <AccessHistoryPanel artifactId="artifact-1" />
    </Provider>,
  );
}

const allowedView: AccessEventListResponse["items"][number] = {
  id: "e1",
  userId: "u1",
  userName: "Ada Lovelace",
  userEmail: "ada@test.local",
  action: "view",
  route: "ui",
  decision: "allowed",
  at: "2026-01-15T10:00:00.000Z",
};

const deniedDownload: AccessEventListResponse["items"][number] = {
  id: "e2",
  userId: "u2",
  userName: "Bob Ross",
  userEmail: "bob@test.local",
  action: "download",
  route: "share_link",
  decision: "denied",
  denyReason: "revoked",
  at: "2026-01-16T10:00:00.000Z",
};

describe("AccessHistoryPanel", () => {
  it("shows an empty state when there are no access events", () => {
    useGetAccessEventsQuery.mockReturnValue({ isLoading: false, isFetching: false, data: { items: [], nextCursor: null } });

    renderWithStore();

    expect(screen.getByText(/no views or downloads recorded yet/i)).toBeInTheDocument();
  });

  it("shows an allowed view with the viewer's name, email, action, and route", () => {
    useGetAccessEventsQuery.mockReturnValue({
      isLoading: false,
      isFetching: false,
      data: { items: [allowedView], nextCursor: null },
    });

    renderWithStore();

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText(/ada@test.local/)).toBeInTheDocument();
    expect(screen.getByText(/Viewed via Web/)).toBeInTheDocument();
    expect(screen.getByText("Allowed")).toBeInTheDocument();
  });

  it("shows a denied download with its reason", () => {
    useGetAccessEventsQuery.mockReturnValue({
      isLoading: false,
      isFetching: false,
      data: { items: [deniedDownload], nextCursor: null },
    });

    renderWithStore();

    expect(screen.getByText(/Downloaded via Share link/)).toBeInTheDocument();
    expect(screen.getByText(/access revoked/i)).toBeInTheDocument();
  });

  it("requests the next page's cursor when Load more is clicked", async () => {
    useGetAccessEventsQuery.mockReturnValue({
      isLoading: false,
      isFetching: false,
      data: { items: [allowedView], nextCursor: "e1" },
    });
    renderWithStore();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /load more/i }));

    expect(useGetAccessEventsQuery).toHaveBeenLastCalledWith({ artifactId: "artifact-1", cursor: "e1" });
  });
});
