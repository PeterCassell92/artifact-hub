import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ArtifactDetail } from "contracts";

const baseArtifact: ArtifactDetail = {
  id: "a1",
  ownerId: "owner-1",
  title: "Report",
  fileName: "report.pdf",
  contentType: "application/pdf",
  kind: "document",
  format: null,
  sizeBytes: 1024,
  publisherName: "Ada",
  publishedAt: "2026-01-01T00:00:00.000Z",
  audienceType: "public_authenticated",
  expiresAt: null,
  isExpired: false,
  commentCount: 0,
  description: null,
  canManagePolicy: false,
};

let queryResult: { data?: ArtifactDetail; isLoading: boolean; error?: unknown };

jest.unstable_mockModule("../store/api", () => ({
  useGetArtifactQuery: () => queryResult,
}));
jest.unstable_mockModule("../components/ArtifactViewer", () => ({
  ArtifactViewer: () => <div>viewer</div>,
}));
jest.unstable_mockModule("../components/CommentForm", () => ({
  CommentForm: () => <div>comment form</div>,
}));
jest.unstable_mockModule("../components/CommentList", () => ({
  CommentList: () => <div>comment list</div>,
}));
jest.unstable_mockModule("../components/AccessPolicyEditor", () => ({
  AccessPolicyEditor: () => <div>policy editor</div>,
}));
jest.unstable_mockModule("../components/AccessPolicySummary", () => ({
  AccessPolicySummary: () => <div>policy summary</div>,
}));
jest.unstable_mockModule("../components/ShareLinkPanel", () => ({
  ShareLinkPanel: () => <div>share link panel</div>,
}));

const { ArtifactDetailPage } = await import("./ArtifactDetailPage");

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/artifacts/a1"]}>
      <Routes>
        <Route path="/artifacts/:id" element={<ArtifactDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ArtifactDetailPage — access policy panel by role", () => {
  it("shows the editable policy editor for the owner (canManagePolicy)", () => {
    queryResult = { data: { ...baseArtifact, canManagePolicy: true }, isLoading: false };
    renderPage();

    expect(screen.getByText("policy editor")).toBeInTheDocument();
    expect(screen.queryByText("policy summary")).not.toBeInTheDocument();
    expect(screen.getByText("share link panel")).toBeInTheDocument();
  });

  // A non-owner who can view the artifact can't change its policy, but can still see it and
  // mint a share link — a share link is a pure locator that never grants more than the
  // redeemer's own view access already allows (03 §5).
  it("shows a read-only policy summary and still offers a share link for a non-owner viewer", () => {
    queryResult = { data: { ...baseArtifact, canManagePolicy: false }, isLoading: false };
    renderPage();

    expect(screen.getByText("policy summary")).toBeInTheDocument();
    expect(screen.queryByText("policy editor")).not.toBeInTheDocument();
    expect(screen.getByText("share link panel")).toBeInTheDocument();
  });
});
