import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";
import { AppLayout } from "./components/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { ShareLinkRedemptionPage } from "./pages/ShareLinkRedemptionPage";
import { DashboardPage } from "./pages/DashboardPage";
import { GetStartedPage } from "./pages/GetStartedPage";
import { MyArtifactsPage } from "./pages/MyArtifactsPage";
import { SharedWithMePage } from "./pages/SharedWithMePage";
import { ArtifactDetailPage } from "./pages/ArtifactDetailPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminGroupsPage } from "./pages/AdminGroupsPage";

/** Route map per docs/frontend/01 §2. No /publish route — publishing is MCP-only. */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/s/:token" element={<ShareLinkRedemptionPage />} />

        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/get-started" element={<GetStartedPage />} />
          <Route path="/artifacts" element={<MyArtifactsPage />} />
          <Route path="/shared" element={<SharedWithMePage />} />
          <Route path="/artifacts/:id" element={<ArtifactDetailPage />} />

          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/groups" element={<AdminGroupsPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
