import { useState } from "react";
import type { AccessPolicyInput, ArtifactDetail, AudienceType, ExpiryOption } from "contracts";
import {
  useListGroupsQuery,
  useListUsersQuery,
  useRevokeAccessMutation,
  useUpdatePolicyMutation,
} from "../store/api";
import { useAppDispatch } from "../store/hooks";
import { notify } from "../store/slices/notifications";
import { artifactStatusLabel, audiencePolicyMissing } from "../lib/formatters";
import { AccessPolicyFields } from "./AccessPolicyFields";
import { Modal } from "./Modal";

const STATUS_COLOR: Record<ReturnType<typeof artifactStatusLabel>, string> = {
  Accessible: "text-neutral-500",
  Expired: "text-red-600",
  Revoked: "text-red-600",
};

/** Audience + expiry (24h/7d/30d/never) — narrowing is what revocation actually is (03 §4),
 * plus an explicit instant "Revoke all access" cutoff (03 §1a), independent of those fields.
 * Owner-only, gated by artifact.canManagePolicy. */
export function AccessPolicyEditor({ artifact }: { artifact: ArtifactDetail }) {
  const [audienceType, setAudienceType] = useState<AudienceType>(artifact.audienceType);
  const [userEmails, setUserEmails] = useState<string[]>([]);
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<ExpiryOption>("never");
  const [updatePolicy, { isLoading }] = useUpdatePolicyMutation();
  const [revokeAccess, { isLoading: isRevoking }] = useRevokeAccessMutation();
  // Backend-driven — not the audience owner's own memberships, the full org group/user
  // catalogue (matches what the equivalent MCP `list_groups` tool exposes to any authenticated
  // caller). Selection-only combo boxes, never free text (03 §1).
  const { data: groups } = useListGroupsQuery(undefined, { skip: audienceType !== "user_groups" });
  const { data: users } = useListUsersQuery(undefined, { skip: audienceType !== "specific_users" });
  const dispatch = useAppDispatch();

  // While revoked, the form starts disabled — stale settings shouldn't look editable/live.
  // "Re-open Access" only unlocks the fields client-side; nothing persists until Save Policy.
  const [unlocked, setUnlocked] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const locked = artifact.revoked && !unlocked;
  const status = artifactStatusLabel(artifact);

  // Gated on submit, not live-disabled: userEmails/groupNames always start empty regardless of
  // the artifact's actual current audience, so a live-disabled Save would show disabled on mount
  // for the common case of an already-specific_users/user_groups artifact. Derived, not sticky —
  // self-clears the moment the user fixes the input, no second Save click needed.
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const { emailsMissing, groupsMissing } = audiencePolicyMissing(audienceType, userEmails, groupNames);

  async function handleSubmit() {
    setSubmitAttempted(true);
    if (locked || emailsMissing || groupsMissing) return;

    const policy: AccessPolicyInput = {
      audienceType,
      expiry,
      ...(audienceType === "specific_users" ? { userEmails } : {}),
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
          previewBaseDate={artifact.publishedAt}
          disabled={locked}
          showValidation={submitAttempted}
        />

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
