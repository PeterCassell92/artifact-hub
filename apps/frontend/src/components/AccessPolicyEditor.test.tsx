import { jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { format } from "date-fns";
import type { ArtifactDetail } from "contracts";
import { makeStore } from "../store/store";

const unwrap = jest.fn<() => Promise<ArtifactDetail>>();
const updatePolicy = jest.fn(() => ({ unwrap }));
const revokeUnwrap = jest.fn<() => Promise<ArtifactDetail>>();
const revokeAccess = jest.fn(() => ({ unwrap: revokeUnwrap }));

const groups = [
  { id: "group-1", name: "Engineering", description: null, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "group-2", name: "Design", description: null, createdAt: "2026-01-01T00:00:00.000Z" },
];

const users = [
  { id: "user-a", email: "a@test.local", name: null },
  { id: "user-b", email: "b@test.local", name: null },
];

jest.unstable_mockModule("../store/api", () => ({
  useUpdatePolicyMutation: () => [updatePolicy, { isLoading: false }],
  useRevokeAccessMutation: () => [revokeAccess, { isLoading: false }],
  useListGroupsQuery: () => ({ data: groups }),
  useListUsersQuery: () => ({ data: users }),
}));

const { AccessPolicyEditor } = await import("./AccessPolicyEditor");

const artifact: ArtifactDetail = {
  id: "artifact-1",
  title: "Report",
  fileName: "report.pdf",
  contentType: "application/pdf",
  kind: "report",
  sizeBytes: 1024,
  publisherName: "Ada",
  publishedAt: "2026-01-01T00:00:00.000Z",
  audienceType: "specific_users",
  expiresAt: null,
  isExpired: false,
  revoked: false,
  commentCount: 0,
  description: null,
  ownerId: "owner-1",
  canManagePolicy: true,
  canViewAccessEvents: true,
  tags: [],
  aiSummary: null,
  aiTopics: [],
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
    revokeAccess.mockClear();
    revokeUnwrap.mockReset().mockResolvedValue({ ...artifact, revoked: true });
  });

  it("does not show a validation message on initial render for an artifact whose current audience is already specific_users", () => {
    renderWithStore();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks Save Policy and shows inline feedback when specific_users has nobody selected", async () => {
    renderWithStore();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /save policy/i }));

    expect(updatePolicy).not.toHaveBeenCalled();
    expect(screen.getByText(/select at least one person/i)).toBeInTheDocument();
  });

  it("blocks Save Policy and shows inline feedback when user_groups has no groups checked", async () => {
    renderWithStore();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/audience/i), "user_groups");
    await user.click(screen.getByRole("button", { name: /save policy/i }));

    expect(updatePolicy).not.toHaveBeenCalled();
    expect(screen.getByText(/select at least one group/i)).toBeInTheDocument();
  });

  it("clears the validation message once the missing field is fixed, without a second Save click", async () => {
    renderWithStore();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /save policy/i }));
    expect(screen.getByText(/select at least one person/i)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /a@test\.local/i }));

    expect(screen.queryByText(/select at least one person/i)).not.toBeInTheDocument();
  });

  it("builds the specific_users payload from checked, backend-driven users", async () => {
    renderWithStore();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/audience/i), "specific_users");
    await user.click(screen.getByRole("checkbox", { name: /a@test\.local/i }));
    await user.click(screen.getByRole("checkbox", { name: /b@test\.local/i }));
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

  it("has no free-text input for people — only a checkbox list of real users", () => {
    renderWithStore();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
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

  it("shows Accessible status and a red Revoke all access button for a live policy", () => {
    renderWithStore();

    expect(screen.getByText("Accessible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revoke all access/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /re-open access/i })).not.toBeInTheDocument();
  });

  it("shows the computed expiry date/time below the field as the selection changes", async () => {
    renderWithStore();
    const user = userEvent.setup();

    expect(screen.getByText("Access never expires.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/expiry/i), "24h");

    const expected = new Date(new Date(artifact.publishedAt).getTime() + 24 * 60 * 60 * 1000);
    expect(screen.getByText(`Access will expire ${format(expected, "MMM d, yyyy 'at' h:mm a")}.`)).toBeInTheDocument();
  });

  it("warns before saving an expiry that has already passed relative to publishedAt", async () => {
    // Published 10 days ago (well before "now") — "7d" from publish already elapsed.
    const staleArtifact = { ...artifact, publishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() };
    render(
      <Provider store={makeStore()}>
        <AccessPolicyEditor artifact={staleArtifact} />
      </Provider>,
    );
    const user = userEvent.setup();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/expiry/i), "7d");

    expect(screen.getByRole("alert")).toHaveTextContent(/immediately revoke access/i);
  });

  it("asks for confirmation before revoking, then calls the mutation", async () => {
    renderWithStore();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /revoke all access/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/immediately lose access/i);

    await user.click(within(dialog).getByRole("button", { name: /revoke all access/i }));

    expect(revokeAccess).toHaveBeenCalledWith("artifact-1");
  });

  it("cancelling the confirmation dialog does not revoke", async () => {
    renderWithStore();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /revoke all access/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(revokeAccess).not.toHaveBeenCalled();
  });

  it("disables the form and Save, and offers Re-open Access, once revoked", () => {
    render(
      <Provider store={makeStore()}>
        <AccessPolicyEditor artifact={{ ...artifact, revoked: true }} />
      </Provider>,
    );

    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.getByLabelText(/audience/i)).toBeDisabled();
    expect(screen.getByLabelText(/expiry/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /save policy/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /re-open access/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^revoke all access$/i })).not.toBeInTheDocument();
  });

  it("Re-open Access unlocks the form client-side without calling any mutation", async () => {
    render(
      <Provider store={makeStore()}>
        <AccessPolicyEditor artifact={{ ...artifact, revoked: true }} />
      </Provider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /re-open access/i }));

    expect(screen.getByLabelText(/audience/i)).toBeEnabled();
    expect(screen.getByRole("button", { name: /save policy/i })).toBeEnabled();
    // Status stays "Revoked" until the owner actually saves a fresh policy.
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(revokeAccess).not.toHaveBeenCalled();
    expect(updatePolicy).not.toHaveBeenCalled();
  });
});
