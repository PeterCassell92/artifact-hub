import { useState } from "react";
import { useCreateShareLinkMutation } from "../store/api";
import { useAppDispatch } from "../store/hooks";
import { notify } from "../store/slices/notifications";

/** No revoke button — the only way to revoke is narrowing the access policy (see
 * AccessPolicyEditor); the backend has no per-link revoke route (06 §4 marks it optional). */
export function ShareLinkPanel({ artifactId }: { artifactId: string }) {
  const [createShareLink, { data, isLoading }] = useCreateShareLinkMutation();
  const [copied, setCopied] = useState(false);
  const dispatch = useAppDispatch();

  async function handleCreate() {
    try {
      await createShareLink(artifactId).unwrap();
      setCopied(false);
    } catch {
      dispatch(notify("error", "Failed to create a share link"));
    }
  }

  async function handleCopy() {
    if (!data) return;
    await navigator.clipboard.writeText(data.url);
    setCopied(true);
  }

  return (
    <div className="rounded-md border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-700">Share link</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Anyone with this link still needs to pass the access policy above to view the artifact.
      </p>

      {data ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={data.url}
            className="flex-1 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={isLoading}
          onClick={() => void handleCreate()}
          className="mt-3 rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          Create share link
        </button>
      )}
    </div>
  );
}
