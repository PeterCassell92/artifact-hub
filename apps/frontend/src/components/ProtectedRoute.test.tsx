import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const loginWithRedirect = jest.fn();
const useAuth0 = jest.fn<
  () => {
    isLoading: boolean;
    isAuthenticated: boolean;
    error?: Error;
    loginWithRedirect: typeof loginWithRedirect;
  }
>();

jest.unstable_mockModule("@auth0/auth0-react", () => ({
  useAuth0: () => useAuth0(),
}));

const { ProtectedRoute } = await import("./ProtectedRoute");

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/artifacts"]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/artifacts" element={<div>Protected content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    loginWithRedirect.mockClear();
  });

  it("redirects to Auth0 login when not authenticated, without rendering the route", () => {
    useAuth0.mockReturnValue({ isLoading: false, isAuthenticated: false, loginWithRedirect });

    renderRoute();

    expect(loginWithRedirect).toHaveBeenCalledWith(
      expect.objectContaining({ appState: { returnTo: "/artifacts" } }),
    );
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("renders the route once authenticated", () => {
    useAuth0.mockReturnValue({ isLoading: false, isAuthenticated: true, loginWithRedirect });

    renderRoute();

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(loginWithRedirect).not.toHaveBeenCalled();
  });

  it("does NOT retry loginWithRedirect when Auth0 reports an error — regression test for the redirect loop", () => {
    useAuth0.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      error: new Error("Invalid state"),
      loginWithRedirect,
    });

    renderRoute();

    expect(loginWithRedirect).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/sign-in failed: invalid state/i);
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("lets the user manually retry after a sign-in error", async () => {
    useAuth0.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      error: new Error("Invalid state"),
      loginWithRedirect,
    });

    renderRoute();
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));

    expect(loginWithRedirect).toHaveBeenCalledTimes(1);
  });
});
