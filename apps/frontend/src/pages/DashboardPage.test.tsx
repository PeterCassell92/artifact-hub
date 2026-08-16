import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const emptyList = { data: { items: [], nextCursor: null } };
jest.unstable_mockModule("../store/api", () => ({
  useGetMeQuery: () => ({ data: { id: "u1", email: "ada@test.local", name: "Ada", role: "member", status: "active", groupNames: [] } }),
  useGetMyArtifactsQuery: () => emptyList,
  useGetSharedWithMeQuery: () => emptyList,
}));

const { DashboardPage } = await import("./DashboardPage");

function clearVisitedCookie() {
  document.cookie = "artifact-hub-visited-get-started=; path=/; max-age=0";
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/get-started" element={<div>Get Started page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DashboardPage — first-visit redirect", () => {
  beforeEach(() => {
    clearVisitedCookie();
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
