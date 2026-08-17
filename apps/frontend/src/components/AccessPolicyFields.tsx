import type { AudienceType, ExpiryOption, GroupView, PublicUserView } from "contracts";
import {
  audiencePolicyMissing,
  computeExpiresAtPreview,
  formatPublishedAtWithTime,
} from "../lib/formatters";
import { InfoTooltip } from "./InfoTooltip";

export const EXPIRY_OPTIONS: { value: ExpiryOption; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "Never" },
];

function toggleValue(selected: string[], value: string): string[] {
  return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
}

interface AccessPolicyFieldsProps {
  audienceType: AudienceType;
  onAudienceTypeChange: (value: AudienceType) => void;
  /** Selected emails — a selection from the combo box below, never free text (users must be
   * chosen from real accounts; see docs/architecture/03 §1). */
  userEmails: string[];
  onUserEmailsChange: (value: string[]) => void;
  users: PublicUserView[] | undefined;
  groupNames: string[];
  onGroupNamesChange: (value: string[]) => void;
  groups: GroupView[] | undefined;
  expiry: ExpiryOption;
  onExpiryChange: (value: ExpiryOption) => void;
  /** ISO timestamp expiry buckets are computed relative to — the artifact's `publishedAt` when
   * editing a live policy, or roughly "now" when setting the initial policy at publish time. */
  previewBaseDate: string;
  disabled?: boolean;
  /** Only show validation messages once the owner has tried to submit (see AccessPolicyEditor /
   * PublishArtifactModal — gated-on-submit, not live-disabled, so a field that already has a
   * valid value doesn't render disabled/invalid on first paint). */
  showValidation: boolean;
}

/** Audience + expiry (24h/7d/30d/never) fields, shared by AccessPolicyEditor (editing a live
 * policy) and PublishArtifactModal's access-policy step (setting the initial policy at publish
 * time) — one place for the audience-requires-emails/groups validation and the expiry preview
 * so the two flows can't silently drift apart. */
export function AccessPolicyFields({
  audienceType,
  onAudienceTypeChange,
  userEmails,
  onUserEmailsChange,
  users,
  groupNames,
  onGroupNamesChange,
  groups,
  expiry,
  onExpiryChange,
  previewBaseDate,
  disabled = false,
  showValidation,
}: AccessPolicyFieldsProps) {
  const { emailsMissing, groupsMissing } = audiencePolicyMissing(audienceType, userEmails, groupNames);
  const previewExpiresAt = computeExpiresAtPreview(expiry, previewBaseDate);
  const willExpireImmediately = previewExpiresAt !== null && previewExpiresAt <= new Date();

  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        Audience
        <select
          value={audienceType}
          disabled={disabled}
          onChange={(e) => onAudienceTypeChange(e.target.value as AudienceType)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:bg-neutral-100 disabled:text-neutral-400"
        >
          <option value="public_authenticated">Anyone signed in</option>
          <option value="specific_users">Specific people</option>
          <option value="user_groups">Groups</option>
        </select>
      </label>

      {audienceType === "specific_users" && (
        <fieldset className="flex flex-col gap-1" disabled={disabled}>
          <legend>People</legend>
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-neutral-300 px-3 py-1.5">
            {users?.length === 0 && <p className="text-neutral-500">No other users exist yet.</p>}
            {users?.map((user) => (
              <label key={user.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={userEmails.includes(user.email)}
                  onChange={() => onUserEmailsChange(toggleValue(userEmails, user.email))}
                />
                {user.email}
                {user.name ? ` (${user.name})` : ""}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {showValidation && emailsMissing && (
        <p className="text-sm text-red-600" role="alert">
          Select at least one person before saving.
        </p>
      )}

      {audienceType === "user_groups" && (
        <fieldset className="flex flex-col gap-1" disabled={disabled}>
          <legend>Groups</legend>
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-neutral-300 px-3 py-1.5">
            {groups?.length === 0 && <p className="text-neutral-500">No groups exist yet.</p>}
            {groups?.map((group) => (
              <label key={group.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={groupNames.includes(group.name)}
                  onChange={() => onGroupNamesChange(toggleValue(groupNames, group.name))}
                />
                {group.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {showValidation && groupsMissing && (
        <p className="text-sm text-red-600" role="alert">
          Select at least one group before saving.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <label htmlFor="access-policy-expiry">Expiry</label>
          <InfoTooltip label="Relative to when this artifact was published, not to when you change this setting." />
        </span>
        <select
          id="access-policy-expiry"
          value={expiry}
          disabled={disabled}
          onChange={(e) => onExpiryChange(e.target.value as ExpiryOption)}
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

      {willExpireImmediately && !disabled && (
        <p className="text-sm text-red-600" role="alert">
          This expiry has already passed relative to when this artifact was published — saving
          will immediately revoke access for everyone else.
        </p>
      )}
    </div>
  );
}
