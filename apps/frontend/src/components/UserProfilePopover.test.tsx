import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserView } from "contracts";
import { UserProfilePopover } from "./UserProfilePopover";

const user: UserView = {
  id: "u1",
  email: "ada@test.local",
  name: "Ada Lovelace",
  role: "member",
  status: "active",
  groupNames: ["Engineering", "Research"],
  createdAt: "2026-01-15T00:00:00.000Z",
};

describe("UserProfilePopover", () => {
  it("hides the popover until the name is clicked", () => {
    render(<UserProfilePopover user={user} />);

    expect(screen.queryByRole("dialog", { name: "Your profile" })).not.toBeInTheDocument();
  });

  it("shows email, groups, and join date when opened", async () => {
    render(<UserProfilePopover user={user} />);

    await userEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));

    const popover = screen.getByRole("dialog", { name: "Your profile" });
    expect(popover).toHaveTextContent("ada@test.local");
    expect(popover).toHaveTextContent("Engineering, Research");
    expect(popover).toHaveTextContent("January 15, 2026");
  });

  it("closes when clicking outside", async () => {
    render(
      <div>
        <UserProfilePopover user={user} />
        <button type="button">outside</button>
      </div>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));
    expect(screen.getByRole("dialog", { name: "Your profile" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("dialog", { name: "Your profile" })).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    render(<UserProfilePopover user={user} />);

    await userEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));
    expect(screen.getByRole("dialog", { name: "Your profile" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Your profile" })).not.toBeInTheDocument();
  });

  it("shows a placeholder when the user has no groups", async () => {
    render(<UserProfilePopover user={{ ...user, groupNames: [] }} />);

    await userEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));

    expect(screen.getByRole("dialog", { name: "Your profile" })).toHaveTextContent("—");
  });
});
