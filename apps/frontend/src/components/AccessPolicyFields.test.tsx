import { jest } from "@jest/globals";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AudienceType, ExpiryOption, GroupView, PublicUserView } from "contracts";
import { AccessPolicyFields } from "./AccessPolicyFields";

const groups: GroupView[] = [
  { id: "group-1", name: "Engineering", description: null, createdAt: "2026-01-01T00:00:00.000Z" },
];

const users: PublicUserView[] = [{ id: "user-1", email: "ada@test.local", name: "Ada" }];

function Harness({ showValidation = false }: { showValidation?: boolean }) {
  const [audienceType, setAudienceType] = useState<AudienceType>("specific_users");
  const [userEmails, setUserEmails] = useState<string[]>([]);
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<ExpiryOption>("never");

  return (
    <AccessPolicyFields
      audienceType={audienceType}
      onAudienceTypeChange={setAudienceType}
      userEmails={userEmails}
      onUserEmailsChange={setUserEmails}
      users={users}
      groupNames={groupNames}
      onGroupNamesChange={setGroupNames}
      groups={groups}
      expiry={expiry}
      onExpiryChange={setExpiry}
      previewBaseDate="2026-01-01T00:00:00.000Z"
      showValidation={showValidation}
    />
  );
}

describe("AccessPolicyFields", () => {
  it("shows 'Access never expires.' by default (expiry = never)", () => {
    render(<Harness />);

    expect(screen.getByText("Access never expires.")).toBeInTheDocument();
  });

  it("shows a validation alert for specific_users with nobody selected only when showValidation is true", () => {
    const { rerender } = render(<Harness showValidation={false} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(<Harness showValidation />);
    expect(screen.getByText(/select at least one person/i)).toBeInTheDocument();
  });

  it("lists real users as checkboxes — no free-text email input", () => {
    render(<Harness />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /ada@test\.local/i })).toBeInTheDocument();
  });

  it("switching to user_groups lists backend-driven group checkboxes", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/audience/i), "user_groups");

    expect(screen.getByRole("checkbox", { name: "Engineering" })).toBeInTheDocument();
  });

  it("disables every field when disabled is true", () => {
    render(
      <AccessPolicyFields
        audienceType="specific_users"
        onAudienceTypeChange={jest.fn()}
        userEmails={[]}
        onUserEmailsChange={jest.fn()}
        users={users}
        groupNames={[]}
        onGroupNamesChange={jest.fn()}
        groups={groups}
        expiry="never"
        onExpiryChange={jest.fn()}
        previewBaseDate="2026-01-01T00:00:00.000Z"
        disabled
        showValidation={false}
      />,
    );

    expect(screen.getByLabelText(/audience/i)).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /ada@test\.local/i })).toBeDisabled();
  });
});
