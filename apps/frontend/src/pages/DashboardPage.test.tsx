import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { makeStore } from "../store/store";

const emptyList = { data: { items: [], nextCursor: null } };
const useGetMyArtifactsQuery = jest.fn(() => emptyList);
const useGetSharedWithMeQuery = jest.fn(() => emptyList);

jest.unstable_mockModule("../store/api", () => ({
  useGetMeQuery: () => ({ data: { id: "u1", email: "ada@test.local", name: "Ada", role: "member", status: "active", groupNames: [], createdAt: "2026-01-01T00:00:00.000Z" } }),
  useGetMyArtifactsQuery: (...args: unknown[]) => useGetMyArtifactsQuery(...(args as [])),
  useGetSharedWithMeQuery: (...args: unknown[]) => useGetSharedWithMeQuery(...(args as [])),
  useCreateArtifactMutation: () => [jest.fn(), { isLoading: false }],
  useFinalizeArtifactMutation: () => [jest.fn(), { isLoading: false }],
  useListGroupsQuery: () => ({ data: [] }),
  useListUsersQuery: () => ({ data: [] }),
}));

const { DashboardPage } = await import("./DashboardPage");

function clearVisitedCookie() {
  document.cookie = "artifact-hub-visited-get-started=; path=/; max-age=0";
}

function renderDashboard() {
  return render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/get-started" element={<div>Get Started page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe("DashboardPage — first-visit redirect", () => {
  beforeEach(() => {
    clearVisitedCookie();
    useGetMyArtifactsQuery.mockClear();
    useGetSharedWithMeQuery.mockClear();
  });

  it("redirects to /get-started on a first visit and sets the cookie", async () => {
    renderDashboard();

    expect(await screen.findByText("Get Started page")).toBeInTheDocument();
    expect(document.cookie).toContain("artifact-hub-visited-get-started=1");
  });

  it("does not redirect on a later visit once the cookie is set", () => {
    document.cookie = "artifact-hub-visited-get-started=1; path=/; max-age=31536000";

    renderDashboard();

    expect(screen.getByText(/welcome, ada/i)).toBeInTheDocument();
    expect(screen.queryByText("Get Started page")).not.toBeInTheDocument();
  });
});

describe("DashboardPage — Publish New Artifact + recent-list size", () => {
  beforeEach(() => {
    document.cookie = "artifact-hub-visited-get-started=1; path=/; max-age=31536000";
    useGetMyArtifactsQuery.mockClear();
    useGetSharedWithMeQuery.mockClear();
  });

  it("renders a full-width Publish New Artifact button under My Artifacts", () => {
    renderDashboard();

    expect(screen.getByRole("button", { name: /publish new artifact/i })).toBeInTheDocument();
  });

  it("requests only the 3 most recent items for both My Artifacts and Shared With Me", () => {
    renderDashboard();

    expect(useGetMyArtifactsQuery).toHaveBeenCalledWith({ limit: 3 });
    expect(useGetSharedWithMeQuery).toHaveBeenCalledWith({ limit: 3 });
  });
});
