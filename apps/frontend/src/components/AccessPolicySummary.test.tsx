import { render, screen } from "@testing-library/react";
import type { ArtifactDetail } from "contracts";
import { AccessPolicySummary } from "./AccessPolicySummary";

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
};

describe("AccessPolicySummary", () => {
  it("shows the audience label and expiry for the current policy", () => {
    render(<AccessPolicySummary artifact={{ ...baseArtifact, audienceType: "user_groups" }} />);

    expect(screen.getByText("Groups")).toBeInTheDocument();
    expect(screen.getByText("Never expires")).toBeInTheDocument();
  });

  it("has no edit controls — read-only for non-owners", () => {
    render(<AccessPolicySummary artifact={baseArtifact} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
