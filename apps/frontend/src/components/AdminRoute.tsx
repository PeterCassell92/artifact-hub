import { Navigate, Outlet } from "react-router-dom";
import { useGetMeQuery } from "../store/api";

/**
 * Nav/route hiding only — `requireAdmin()` on the backend is the real gate (CLAUDE.md: never
 * re-implement authz client-side). `role` here is read from `/api/me`, which itself reads the DB,
 * not a token claim, matching "read role from the DB, never trust token claims".
 */
export function AdminRoute() {
  const { data, isLoading } = useGetMeQuery();

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-neutral-600" role="status">
        Loading…
      </div>
    );
  }

  if (data?.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
