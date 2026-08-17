import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { UserView } from "contracts";

const useGetMeQuery = jest.fn<() => { isLoading: boolean; data?: UserView }>();
jest.unstable_mockModule("../store/api", () => ({
  useGetMeQuery: () => useGetMeQuery(),
}));

const { AdminRoute } = await import("./AdminRoute");

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/admin/users"]}>
      <Routes>
        <Route path="/" element={<div>Dashboard</div>} />
        <Route element={<AdminRoute />}>
          <Route path="/admin/users" element={<div>Admin content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminRoute", () => {
  it("hides admin routes from a non-admin member (redirects to /)", () => {
    useGetMeQuery.mockReturnValue({
      isLoading: false,
      data: { id: "u1", email: "m@test.local", name: "Test Member", role: "member", status: "active", groupNames: [], createdAt: "2026-01-01T00:00:00.000Z" },
    });

    renderRoute();

    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("renders admin routes for an admin", () => {
    useGetMeQuery.mockReturnValue({
      isLoading: false,
      data: { id: "u1", email: "a@test.local", name: "Test Admin", role: "admin", status: "active", groupNames: [], createdAt: "2026-01-01T00:00:00.000Z" },
    });

    renderRoute();

    expect(screen.getByText("Admin content")).toBeInTheDocument();
  });
});
