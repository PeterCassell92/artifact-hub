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
import { CompleteUploadPage } from "./pages/CompleteUploadPage";
import { AdminPage } from "./pages/AdminPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminGroupsPage } from "./pages/AdminGroupsPage";

/** Route map per docs/frontend/01 §2. Publishing is available both via an agent (MCP
 * publish_artifact) and the Dashboard's Publish New Artifact modal — no dedicated /publish
 * route either way; /artifacts/:id/complete-upload only *finishes* an already-started publish
 * (the MCP tool's webUploadUrl, 01 decision #47), it doesn't start one. */
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
          <Route path="/artifacts/:id/complete-upload" element={<CompleteUploadPage />} />

          <Route element={<AdminRoute />}>
            <Route element={<AdminPage />}>
              <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/groups" element={<AdminGroupsPage />} />
            </Route>
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
