import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ArtifactDetail } from "contracts";

const baseArtifact: ArtifactDetail = {
  id: "a1",
  ownerId: "owner-1",
  title: "Report",
  fileName: "report.pdf",
  contentType: "application/pdf",
  kind: "document",
  sizeBytes: 1024,
  publisherName: "Ada",
  publishedAt: "2026-01-01T00:00:00.000Z",
  audienceType: "public_authenticated",
  expiresAt: null,
  isExpired: false,
  revoked: false,
  commentCount: 0,
  description: null,
  canManagePolicy: false,
  canViewAccessEvents: false,
  tags: [],
  aiSummary: null,
  aiTopics: [],
  conversationSummary: null,
  conversationMessageCount: null,
  conversationFirstMessageAt: null,
  conversationFinalMessageAt: null,
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
jest.unstable_mockModule("../components/RelatedArtifacts", () => ({
  RelatedArtifacts: () => <div>related artifacts</div>,
}));
jest.unstable_mockModule("../components/AccessHistoryPanel", () => ({
  AccessHistoryPanel: () => <div>access history panel</div>,
}));
jest.unstable_mockModule("../components/EnrichmentPanel", () => ({
  EnrichmentPanel: () => <div>enrichment panel</div>,
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

describe("ArtifactDetailPage — Back button", () => {
  it("navigates to the previous router entry rather than a fixed route", async () => {
    queryResult = { data: { ...baseArtifact, canManagePolicy: true }, isLoading: false };
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/artifacts?kind=document", "/artifacts/a1"]} initialIndex={1}>
        <Routes>
          <Route path="/artifacts" element={<div>My Artifacts filtered view</div>} />
          <Route path="/artifacts/:id" element={<ArtifactDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /back/i }));

    expect(screen.getByText("My Artifacts filtered view")).toBeInTheDocument();
  });
});

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

describe("ArtifactDetailPage — access history panel by role", () => {
  it("shows the Access History panel when the viewer can view access events (owner or admin)", () => {
    queryResult = { data: { ...baseArtifact, canViewAccessEvents: true }, isLoading: false };
    renderPage();

    expect(screen.getByText("Access History")).toBeInTheDocument();
    expect(screen.getByText("access history panel")).toBeInTheDocument();
  });

  it("hides the Access History panel for a viewer who is neither owner nor admin", () => {
    queryResult = { data: { ...baseArtifact, canViewAccessEvents: false }, isLoading: false };
    renderPage();

    expect(screen.queryByText("Access History")).not.toBeInTheDocument();
    expect(screen.queryByText("access history panel")).not.toBeInTheDocument();
  });
});

describe("ArtifactDetailPage — conversation summary", () => {
  it("shows the Conversation Summary section when the artifact has one", () => {
    queryResult = { data: { ...baseArtifact, conversationSummary: "Discussed and fixed the DMARC record." }, isLoading: false };
    renderPage();

    expect(screen.getByText("Conversation Summary")).toBeInTheDocument();
    expect(screen.getByText(/discussed and fixed the dmarc record/i)).toBeInTheDocument();
  });

  it("omits the Conversation Summary section when the artifact doesn't have one", () => {
    queryResult = { data: baseArtifact, isLoading: false };
    renderPage();

    expect(screen.queryByText("Conversation Summary")).not.toBeInTheDocument();
  });
});
