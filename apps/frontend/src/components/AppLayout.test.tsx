import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { UserView } from "contracts";
import { makeStore } from "../store/store";

const useGetMeQuery = jest.fn<() => { data?: UserView }>();
jest.unstable_mockModule("../store/api", () => ({
  useGetMeQuery: () => useGetMeQuery(),
}));

const logout = jest.fn();
jest.unstable_mockModule("@auth0/auth0-react", () => ({
  useAuth0: () => ({ logout }),
}));

const { AppLayout } = await import("./AppLayout");

function renderLayout() {
  return render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe("AppLayout", () => {
  it("does not render an Admin link for a non-admin member", () => {
    useGetMeQuery.mockReturnValue({
      data: { id: "u1", email: "m@test.local", name: "Test Member", role: "member", status: "active", groupNames: [], createdAt: "2026-01-01T00:00:00.000Z" },
    });

    renderLayout();

    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("renders the Admin link outside the main navlinks, styled as a light-blue pill, left of the email", () => {
    useGetMeQuery.mockReturnValue({
      data: { id: "u1", email: "admin@test.local", name: "Test Admin", role: "admin", status: "active", groupNames: [], createdAt: "2026-01-01T00:00:00.000Z" },
    });

    renderLayout();

    const adminLink = screen.getByRole("link", { name: "Admin" });
    expect(adminLink).toHaveClass("bg-blue-100", "text-blue-800");

    const mainNav = screen.getByRole("navigation");
    expect(mainNav).not.toContainElement(adminLink);

    const email = screen.getByText("admin@test.local");
    expect(
      adminLink.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
