import { useState } from "react";
import type { AccessPolicyInput, ArtifactDetail, AudienceType, ExpiryOption } from "contracts";
import { useListGroupsQuery, useUpdatePolicyMutation } from "../store/api";
import { useAppDispatch } from "../store/hooks";
import { notify } from "../store/slices/notifications";

const EXPIRY_OPTIONS: { value: ExpiryOption; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "Never" },
];

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toggleGroupName(selected: string[], name: string): string[] {
  return selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name];
}

/** Audience + expiry (24h/7d/30d/never) — narrowing is what revocation actually is (03 §4),
 * there is no separate "revoke" action. Owner-only, gated by artifact.canManagePolicy. */
export function AccessPolicyEditor({ artifact }: { artifact: ArtifactDetail }) {
  const [audienceType, setAudienceType] = useState<AudienceType>(artifact.audienceType);
  const [userEmails, setUserEmails] = useState("");
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<ExpiryOption>("never");
  const [updatePolicy, { isLoading }] = useUpdatePolicyMutation();
  // Backend-driven — not the audience owner's own memberships, the full org group catalogue
  // (matches what the equivalent MCP `list_groups` tool exposes to any authenticated caller).
  const { data: groups } = useListGroupsQuery(undefined, { skip: audienceType !== "user_groups" });
  const dispatch = useAppDispatch();

  async function handleSubmit() {
    const policy: AccessPolicyInput = {
      audienceType,
      expiry,
      ...(audienceType === "specific_users" ? { userEmails: splitList(userEmails) } : {}),
      ...(audienceType === "user_groups" ? { groupNames } : {}),
    };

    try {
      await updatePolicy({ artifactId: artifact.id, policy }).unwrap();
      dispatch(notify("success", "Access policy updated"));
    } catch {
      dispatch(notify("error", "Failed to update the access policy — check the emails/groups entered"));
    }
  }

  return (
    <div className="rounded-md border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-700">Access policy</h2>

      <div className="mt-3 flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Audience
          <select
            value={audienceType}
            onChange={(e) => setAudienceType(e.target.value as AudienceType)}
            className="rounded-md border border-neutral-300 px-3 py-1.5"
          >
            <option value="public_authenticated">Anyone signed in</option>
            <option value="specific_users">Specific people</option>
            <option value="user_groups">Groups</option>
          </select>
        </label>

        {audienceType === "specific_users" && (
          <label className="flex flex-col gap-1">
            User emails (comma-separated)
            <input
              value={userEmails}
              onChange={(e) => setUserEmails(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-1.5"
            />
          </label>
        )}

        {audienceType === "user_groups" && (
          <fieldset className="flex flex-col gap-1">
            <legend>Groups</legend>
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-neutral-300 px-3 py-1.5">
              {groups?.length === 0 && <p className="text-neutral-500">No groups exist yet.</p>}
              {groups?.map((group) => (
                <label key={group.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={groupNames.includes(group.name)}
                    onChange={() => setGroupNames((prev) => toggleGroupName(prev, group.name))}
                  />
                  {group.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="flex flex-col gap-1">
          Expiry
          <select
            value={expiry}
            onChange={(e) => setExpiry(e.target.value as ExpiryOption)}
            className="rounded-md border border-neutral-300 px-3 py-1.5"
          >
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={isLoading}
          onClick={() => void handleSubmit()}
          className="self-start rounded-md bg-neutral-900 px-4 py-1.5 font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          Save policy
        </button>
      </div>
    </div>
  );
}
