import { useState, type FormEvent } from "react";
import type { UserView } from "contracts";
import {
  useChangeUserRoleMutation,
  useDisableUserMutation,
  useGetGroupsQuery,
  useGetMeQuery,
  useGetUsersQuery,
  useInviteUserMutation,
} from "../store/api";
import { useAppDispatch } from "../store/hooks";
import { notify } from "../store/slices/notifications";
import { Modal } from "../components/Modal";

/** /admin/users — invite, promote/demote, disable (docs/frontend/01 §7). */
export function AdminUsersPage() {
  const { data: me } = useGetMeQuery();
  const { data: users } = useGetUsersQuery();
  const { data: groups } = useGetGroupsQuery();
  const [inviteUser, { isLoading: isInviting }] = useInviteUserMutation();
  const [changeUserRole] = useChangeUserRoleMutation();
  const [disableUser] = useDisableUserMutation();
  const dispatch = useAppDispatch();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<
    { user: UserView; action: "promote" | "demote" | "disable" } | null
  >(null);

  function toggleGroup(id: string) {
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    if (groupIds.length === 0) {
      setEmailError("Select at least one group.");
      return;
    }
    setEmailError(null);

    try {
      await inviteUser({ email, name: name.trim() || undefined, role, groupIds }).unwrap();
      dispatch(notify("success", `Invited ${email}`));
      setEmail("");
      setName("");
      setRole("member");
      setGroupIds([]);
    } catch {
      dispatch(notify("error", "Failed to send invitation"));
    }
  }

  async function handleConfirm() {
    if (!confirmTarget) return;
    const { user, action } = confirmTarget;
    try {
      if (action === "disable") {
        await disableUser(user.id).unwrap();
        dispatch(notify("success", `Disabled ${user.email}`));
      } else {
        await changeUserRole({ userId: user.id, role: action === "promote" ? "admin" : "member" }).unwrap();
        dispatch(notify("success", `${action === "promote" ? "Promoted" : "Demoted"} ${user.email}`));
      }
    } catch {
      dispatch(notify("error", "That action could not be completed"));
    } finally {
      setConfirmTarget(null);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">Users</h1>

      <form
        onSubmit={(e) => void handleInvite(e)}
        noValidate
        className="mt-4 rounded-md border border-neutral-200 bg-white p-4"
      >
        <h2 className="text-sm font-semibold text-neutral-700">Invite a user</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="invite-email" className="block text-xs font-medium text-neutral-600">
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="invite-name" className="block text-xs font-medium text-neutral-600">
              Name
            </label>
            <input
              id="invite-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="block text-xs font-medium text-neutral-600">
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as "member" | "admin")}
              className="mt-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <fieldset>
            <legend className="block text-xs font-medium text-neutral-600">Groups</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {groups?.map((group) => (
                <label key={group.id} className="flex items-center gap-1 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={groupIds.includes(group.id)}
                    onChange={() => toggleGroup(group.id)}
                  />
                  {group.name}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={isInviting}
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            Invite
          </button>
        </div>
        {emailError && (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {emailError}
          </p>
        )}
      </form>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-neutral-500">
            <th className="py-2 font-medium">Email</th>
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Status</th>
            <th className="py-2 font-medium">Role</th>
            <th className="py-2 font-medium">Groups</th>
            <th className="py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users?.map((user) => (
            <tr key={user.id} className="border-b border-neutral-100">
              <td className="py-2">{user.email}</td>
              <td className="py-2">{user.name ?? "—"}</td>
              <td className="py-2">{user.status}</td>
              <td className="py-2">{user.role}</td>
              <td className="py-2">{user.groupNames.join(", ") || "—"}</td>
              <td className="py-2">
                {user.id === me?.id ? (
                  <span className="text-neutral-400">(you)</span>
                ) : (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmTarget({ user, action: user.role === "admin" ? "demote" : "promote" })
                      }
                      className="text-neutral-600 hover:text-neutral-900"
                    >
                      {user.role === "admin" ? "Demote" : "Promote"}
                    </button>
                    {user.status !== "disabled" && (
                      <button
                        type="button"
                        onClick={() => setConfirmTarget({ user, action: "disable" })}
                        className="text-red-600 hover:text-red-800"
                      >
                        Disable
                      </button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal
        open={confirmTarget !== null}
        title="Confirm action"
        onClose={() => setConfirmTarget(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmTarget(null)}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Confirm
            </button>
          </>
        }
      >
        {confirmTarget && (
          <p>
            {confirmTarget.action === "disable"
              ? `Disable ${confirmTarget.user.email}? They will lose access immediately.`
              : `${confirmTarget.action === "promote" ? "Promote" : "Demote"} ${confirmTarget.user.email}?`}
          </p>
        )}
      </Modal>
    </div>
  );
}
