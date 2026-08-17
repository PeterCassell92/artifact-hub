import { useState } from "react";
import type { AccessPolicyInput, ArtifactDetail, AudienceType, ExpiryOption } from "contracts";
import { useListGroupsQuery, useRevokeAccessMutation, useUpdatePolicyMutation } from "../store/api";
import { useAppDispatch } from "../store/hooks";
import { notify } from "../store/slices/notifications";
import { artifactStatusLabel, computeExpiresAtPreview, formatPublishedAtWithTime } from "../lib/formatters";
import { InfoTooltip } from "./InfoTooltip";
import { Modal } from "./Modal";

const EXPIRY_OPTIONS: { value: ExpiryOption; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "Never" },
];

const STATUS_COLOR: Record<ReturnType<typeof artifactStatusLabel>, string> = {
  Accessible: "text-neutral-500",
  Expired: "text-red-600",
  Revoked: "text-red-600",
};

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
 * plus an explicit instant "Revoke all access" cutoff (03 §1a), independent of those fields.
 * Owner-only, gated by artifact.canManagePolicy. */
export function AccessPolicyEditor({ artifact }: { artifact: ArtifactDetail }) {
  const [audienceType, setAudienceType] = useState<AudienceType>(artifact.audienceType);
  const [userEmails, setUserEmails] = useState("");
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<ExpiryOption>("never");
  const [updatePolicy, { isLoading }] = useUpdatePolicyMutation();
  const [revokeAccess, { isLoading: isRevoking }] = useRevokeAccessMutation();
  // Backend-driven — not the audience owner's own memberships, the full org group catalogue
  // (matches what the equivalent MCP `list_groups` tool exposes to any authenticated caller).
  const { data: groups } = useListGroupsQuery(undefined, { skip: audienceType !== "user_groups" });
  const dispatch = useAppDispatch();

  // While revoked, the form starts disabled — stale settings shouldn't look editable/live.
  // "Re-open Access" only unlocks the fields client-side; nothing persists until Save Policy.
  const [unlocked, setUnlocked] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const locked = artifact.revoked && !unlocked;
  const status = artifactStatusLabel(artifact);

  const previewExpiresAt = computeExpiresAtPreview(expiry, artifact.publishedAt);
  const willExpireImmediately = previewExpiresAt !== null && previewExpiresAt <= new Date();

  async function handleSubmit() {
    const policy: AccessPolicyInput = {
      audienceType,
      expiry,
      ...(audienceType === "specific_users" ? { userEmails: splitList(userEmails) } : {}),
      ...(audienceType === "user_groups" ? { groupNames } : {}),
    };

    try {
      await updatePolicy({ artifactId: artifact.id, policy }).unwrap();
      setUnlocked(false);
      dispatch(notify("success", "Access policy updated"));
    } catch {
      dispatch(notify("error", "Failed to update the access policy — check the emails/groups entered"));
    }
  }

  async function handleRevoke() {
    setConfirmingRevoke(false);
    try {
      await revokeAccess(artifact.id).unwrap();
      dispatch(notify("success", "Access revoked — only you can view this artifact now"));
    } catch {
      dispatch(notify("error", "Failed to revoke access"));
    }
  }

  return (
    <div className="rounded-md border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700">Access policy</h2>
        <span className={`text-xs font-medium ${STATUS_COLOR[status]}`}>{status}</span>
      </div>

      <div className="mt-3 flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Audience
          <select
            value={audienceType}
            disabled={locked}
            onChange={(e) => setAudienceType(e.target.value as AudienceType)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:bg-neutral-100 disabled:text-neutral-400"
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
              disabled={locked}
              onChange={(e) => setUserEmails(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:bg-neutral-100 disabled:text-neutral-400"
            />
          </label>
        )}

        {audienceType === "user_groups" && (
          <fieldset className="flex flex-col gap-1" disabled={locked}>
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

        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5">
            <label htmlFor="access-policy-expiry">Expiry</label>
            <InfoTooltip label="Relative to when this artifact was published, not to when you change this setting." />
          </span>
          <select
            id="access-policy-expiry"
            value={expiry}
            disabled={locked}
            onChange={(e) => setExpiry(e.target.value as ExpiryOption)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:bg-neutral-100 disabled:text-neutral-400"
          >
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs text-neutral-500">
          {previewExpiresAt
            ? `Access will expire ${formatPublishedAtWithTime(previewExpiresAt.toISOString())}.`
            : "Access never expires."}
        </p>

        {willExpireImmediately && !locked && (
          <p className="text-sm text-red-600" role="alert">
            This expiry has already passed relative to when this artifact was published — saving
            will immediately revoke access for everyone else.
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isLoading || locked}
            onClick={() => void handleSubmit()}
            className="self-start rounded-md bg-neutral-900 px-4 py-1.5 font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            Save policy
          </button>

          {artifact.revoked ? (
            <button
              type="button"
              onClick={() => setUnlocked(true)}
              className="self-start rounded-md border border-neutral-300 px-4 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Re-open Access
            </button>
          ) : (
            <button
              type="button"
              disabled={isRevoking}
              onClick={() => setConfirmingRevoke(true)}
              className="self-start rounded-md bg-red-600 px-4 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Revoke all access
            </button>
          )}
        </div>
      </div>

      <Modal
        open={confirmingRevoke}
        title="Revoke all access?"
        onClose={() => setConfirmingRevoke(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmingRevoke(false)}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleRevoke()}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Revoke all access
            </button>
          </>
        }
      >
        <p>
          Everyone but you will immediately lose access to this artifact. Your current audience
          and expiry settings are kept and apply again as soon as you re-open access.
        </p>
      </Modal>
    </div>
  );
}
