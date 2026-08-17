import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import type { GroupView, InvitationView, UserView } from "contracts";
import { makeStore } from "../store/store";
import { NotificationRegion } from "../components/NotificationRegion";

const inviteUnwrap = jest.fn<() => Promise<InvitationView>>();
const inviteUser = jest.fn(() => ({ unwrap: inviteUnwrap }));
const useGetMeQuery = jest.fn<() => { data?: UserView }>();
const useGetUsersQuery = jest.fn<() => { data?: UserView[] }>();
const useGetGroupsQuery = jest.fn<() => { data?: GroupView[] }>();
const changeUserRoleUnwrap = jest.fn<() => Promise<void>>();
const disableUserUnwrap = jest.fn<() => Promise<void>>();

jest.unstable_mockModule("../store/api", () => ({
  useGetMeQuery: () => useGetMeQuery(),
  useGetUsersQuery: () => useGetUsersQuery(),
  useGetGroupsQuery: () => useGetGroupsQuery(),
  useInviteUserMutation: () => [inviteUser, { isLoading: false }],
  useChangeUserRoleMutation: () => [jest.fn(() => ({ unwrap: changeUserRoleUnwrap })), { isLoading: false }],
  useDisableUserMutation: () => [jest.fn(() => ({ unwrap: disableUserUnwrap })), { isLoading: false }],
}));

const { AdminUsersPage } = await import("./AdminUsersPage");

function renderPage() {
  return render(
    <Provider store={makeStore()}>
      <NotificationRegion />
      <AdminUsersPage />
    </Provider>,
  );
}

describe("AdminUsersPage", () => {
  beforeEach(() => {
    inviteUser.mockClear();
    inviteUnwrap.mockReset().mockResolvedValue({
      id: "inv1",
      email: "new@test.local",
      role: "member",
      groupNames: ["Engineering"],
      status: "pending",
      invitedByName: "Ada",
      expiresAt: "2026-02-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    useGetGroupsQuery.mockReturnValue({
      data: [{ id: "group-1", name: "Engineering", description: null, createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    useGetMeQuery.mockReturnValue({
      data: {
        id: "admin-self",
        email: "self@test.local",
        name: "Self Admin",
        role: "admin",
        status: "active",
        groupNames: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    useGetUsersQuery.mockReturnValue({
      data: [
        {
          id: "user-1",
          email: "ada@test.local",
          name: "Ada Lovelace",
          role: "member",
          status: "active",
          groupNames: ["Engineering"],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("renders each user's status", () => {
    renderPage();
    expect(screen.getByText("ada@test.local")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("rejects an invalid email instead of inviting", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.click(screen.getByLabelText("Engineering"));
    await user.click(screen.getByRole("button", { name: /^invite$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/valid email/i);
    expect(inviteUser).not.toHaveBeenCalled();
  });

  it("requires a name before inviting", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), "new@test.local");
    await user.click(screen.getByLabelText("Engineering"));
    await user.click(screen.getByRole("button", { name: /^invite$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/enter a name/i);
    expect(inviteUser).not.toHaveBeenCalled();
  });

  it("requires at least one group before inviting", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), "new@test.local");
    await user.type(screen.getByLabelText(/^name$/i), "New Person");
    await user.click(screen.getByRole("button", { name: /^invite$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/select at least one group/i);
    expect(inviteUser).not.toHaveBeenCalled();
  });

  it("invites with the selected email/name/role/groups once valid", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), "new@test.local");
    await user.type(screen.getByLabelText(/^name$/i), "New Person");
    await user.click(screen.getByLabelText("Engineering"));
    await user.click(screen.getByRole("button", { name: /^invite$/i }));

    expect(inviteUser).toHaveBeenCalledWith({
      email: "new@test.local",
      name: "New Person",
      role: "member",
      groupIds: ["group-1"],
    });
  });

  it("hides promote/demote/disable actions for the logged-in admin's own row", () => {
    useGetUsersQuery.mockReturnValue({
      data: [
        {
          id: "admin-self",
          email: "self@test.local",
          name: "Self Admin",
          role: "admin",
          status: "active",
          groupNames: [],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "user-1",
          email: "ada@test.local",
          name: "Ada Lovelace",
          role: "member",
          status: "active",
          groupNames: ["Engineering"],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    renderPage();

    expect(screen.getByText("(you)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /promote/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /disable/i })).toHaveLength(1);
  });
});
