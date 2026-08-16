import { NavLink, Outlet } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { NotificationRegion } from "./NotificationRegion";
import { useGetMeQuery } from "../store/api";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  "rounded-md px-3 py-2 text-sm font-medium " +
  (isActive ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100");

/** Top nav + notifications, wraps every authenticated page (docs/frontend/01 route map). */
export function AppLayout() {
  const { logout } = useAuth0();
  const { data: me } = useGetMeQuery();

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <NotificationRegion />
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Artifact Hub
            </NavLink>
            <NavLink to="/artifacts" className={navLinkClass}>
              My Artifacts
            </NavLink>
            <NavLink to="/shared" className={navLinkClass}>
              Shared With Me
            </NavLink>
            {me?.role === "admin" && (
              <NavLink to="/admin/users" className={navLinkClass}>
                Admin
              </NavLink>
            )}
          </nav>
          <div className="flex items-center gap-3 text-sm text-neutral-600">
            {me && <span>{me.name ?? me.email}</span>}
            <button
              type="button"
              onClick={() => void logout({ logoutParams: { returnTo: window.location.origin } })}
              className="rounded-md px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        <Outlet />
      </main>
    </div>
  );
}
