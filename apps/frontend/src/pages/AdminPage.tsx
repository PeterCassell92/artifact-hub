import { NavLink, Outlet } from "react-router-dom";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  "border-b-2 px-4 py-2 text-sm font-medium " +
  (isActive
    ? "border-neutral-900 text-neutral-900"
    : "border-transparent text-neutral-500 hover:text-neutral-700");

/** /admin/* shell — tabs for Users and Groups (docs/frontend/01 §7). */
export function AdminPage() {
  return (
    <div>
      <nav className="flex gap-2 border-b border-neutral-200" aria-label="Admin sections">
        <NavLink to="/admin/users" className={tabClass}>
          Users
        </NavLink>
        <NavLink to="/admin/groups" className={tabClass}>
          Groups
        </NavLink>
      </nav>
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
