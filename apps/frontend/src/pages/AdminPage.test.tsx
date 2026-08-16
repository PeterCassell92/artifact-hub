import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdminPage } from "./AdminPage";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AdminPage />}>
          <Route path="/admin/users" element={<div>Users content</div>} />
          <Route path="/admin/groups" element={<div>Groups content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminPage", () => {
  it("renders Users and Groups tabs", () => {
    renderAt("/admin/users");

    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Groups" })).toBeInTheDocument();
  });

  it("renders the Users tab content on /admin/users", () => {
    renderAt("/admin/users");

    expect(screen.getByText("Users content")).toBeInTheDocument();
    expect(screen.queryByText("Groups content")).not.toBeInTheDocument();
  });

  it("renders the Groups tab content on /admin/groups", () => {
    renderAt("/admin/groups");

    expect(screen.getByText("Groups content")).toBeInTheDocument();
    expect(screen.queryByText("Users content")).not.toBeInTheDocument();
  });
});
