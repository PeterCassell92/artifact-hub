import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import type { ArtifactDetail } from "contracts";
import { makeStore } from "../store/store";

const unwrap = jest.fn<() => Promise<ArtifactDetail>>();
const updatePolicy = jest.fn(() => ({ unwrap }));

const groups = [
  { id: "group-1", name: "Engineering", description: null, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "group-2", name: "Design", description: null, createdAt: "2026-01-01T00:00:00.000Z" },
];

jest.unstable_mockModule("../store/api", () => ({
  useUpdatePolicyMutation: () => [updatePolicy, { isLoading: false }],
  useListGroupsQuery: () => ({ data: groups }),
}));

const { AccessPolicyEditor } = await import("./AccessPolicyEditor");

const artifact: ArtifactDetail = {
  id: "artifact-1",
  title: "Report",
  fileName: "report.pdf",
  contentType: "application/pdf",
  kind: "report",
  format: null,
  sizeBytes: 1024,
  publisherName: "Ada",
  publishedAt: "2026-01-01T00:00:00.000Z",
  audienceType: "specific_users",
  expiresAt: null,
  isExpired: false,
  commentCount: 0,
  description: null,
  ownerId: "owner-1",
  canManagePolicy: true,
};

function renderWithStore() {
  return render(
    <Provider store={makeStore()}>
      <AccessPolicyEditor artifact={artifact} />
    </Provider>,
  );
}

describe("AccessPolicyEditor", () => {
  beforeEach(() => {
    updatePolicy.mockClear();
    unwrap.mockReset().mockResolvedValue(artifact);
  });

  it("builds the specific_users payload from the entered emails and expiry", async () => {
    renderWithStore();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/audience/i), "specific_users");
    await user.type(screen.getByLabelText(/user emails/i), "a@test.local, b@test.local");
    await user.selectOptions(screen.getByLabelText(/expiry/i), "7d");
    await user.click(screen.getByRole("button", { name: /save policy/i }));

    expect(updatePolicy).toHaveBeenCalledWith({
      artifactId: "artifact-1",
      policy: {
        audienceType: "specific_users",
        expiry: "7d",
        userEmails: ["a@test.local", "b@test.local"],
      },
    });
  });

  it("builds the user_groups payload from checked, backend-driven groups", async () => {
    renderWithStore();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/audience/i), "user_groups");
    await user.click(screen.getByRole("checkbox", { name: "Engineering" }));
    await user.selectOptions(screen.getByLabelText(/expiry/i), "never");
    await user.click(screen.getByRole("button", { name: /save policy/i }));

    expect(updatePolicy).toHaveBeenCalledWith({
      artifactId: "artifact-1",
      policy: {
        audienceType: "user_groups",
        expiry: "never",
        groupNames: ["Engineering"],
      },
    });
  });

  it("builds the public_authenticated payload with no emails/groups", async () => {
    renderWithStore();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/audience/i), "public_authenticated");
    await user.selectOptions(screen.getByLabelText(/expiry/i), "never");
    await user.click(screen.getByRole("button", { name: /save policy/i }));

    expect(updatePolicy).toHaveBeenCalledWith({
      artifactId: "artifact-1",
      policy: { audienceType: "public_authenticated", expiry: "never" },
    });
  });
});
