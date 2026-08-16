import { useState, type FormEvent } from "react";
import { useCreateGroupMutation, useGetGroupsQuery } from "../store/api";
import { useAppDispatch } from "../store/hooks";
import { notify } from "../store/slices/notifications";

/** /admin/groups — list + create (docs/frontend/01 §7). */
export function AdminGroupsPage() {
  const { data: groups } = useGetGroupsQuery();
  const [createGroup, { isLoading }] = useCreateGroupMutation();
  const dispatch = useAppDispatch();
  const [name, setName] = useState("");

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createGroup({ name: name.trim() }).unwrap();
      dispatch(notify("success", `Created group "${name.trim()}"`));
      setName("");
    } catch {
      dispatch(notify("error", "Failed to create group"));
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">Groups</h1>

      <form onSubmit={(e) => void handleCreate(e)} className="mt-4 flex items-end gap-3 rounded-md border border-neutral-200 bg-white p-4">
        <div>
          <label htmlFor="group-name" className="block text-xs font-medium text-neutral-600">
            New group name
          </label>
          <input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          Create
        </button>
      </form>

      <ul className="mt-6 flex flex-col gap-2">
        {groups?.map((group) => (
          <li key={group.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-800">
            {group.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
