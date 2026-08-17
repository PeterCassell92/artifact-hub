import { useRef, useState } from "react";
import type { AudienceType, ExpiryOption } from "contracts";
import {
  useCreateArtifactMutation,
  useFinalizeArtifactMutation,
  useListGroupsQuery,
  useListUsersQuery,
} from "../store/api";
import { useAppDispatch } from "../store/hooks";
import { notify } from "../store/slices/notifications";
import { audiencePolicyMissing, formatBytes } from "../lib/formatters";
import { AccessPolicyFields } from "./AccessPolicyFields";
import { Modal } from "./Modal";

interface PublishArtifactModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = "file" | "policy";

/**
 * "Publish New Artifact" (Dashboard) — the web-UI publish path, alongside the MCP
 * `publish_artifact` tool. A two-step stepper: pick a file, then set its access policy (title
 * defaults to the file's name — there's no title-edit surface yet, matching artifact editing
 * being out of scope for v1, arch/01 §8).
 */
export function PublishArtifactModal({ open, onClose }: PublishArtifactModalProps) {
  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [audienceType, setAudienceType] = useState<AudienceType>("specific_users");
  const [userEmails, setUserEmails] = useState<string[]>([]);
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<ExpiryOption>("never");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const { data: groups } = useListGroupsQuery(undefined, { skip: audienceType !== "user_groups" });
  const { data: users } = useListUsersQuery(undefined, { skip: audienceType !== "specific_users" });
  const { emailsMissing, groupsMissing } = audiencePolicyMissing(audienceType, userEmails, groupNames);

  const [createArtifact] = useCreateArtifactMutation();
  const [finalizeArtifact] = useFinalizeArtifactMutation();
  const dispatch = useAppDispatch();

  function resetState() {
    setStep("file");
    setFile(null);
    setStatus("idle");
    setAudienceType("specific_users");
    setUserEmails([]);
    setGroupNames([]);
    setExpiry("never");
    setSubmitAttempted(false);
  }

  function handleCancel() {
    resetState();
    onClose();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setStatus("idle");
  }

  async function handlePublish() {
    setSubmitAttempted(true);
    if (!file || emailsMissing || groupsMissing) return;

    setStatus("uploading");
    try {
      const contentType = file.type || "application/octet-stream";
      const created = await createArtifact({
        title: file.name,
        fileName: file.name,
        contentType,
        audienceType,
        expiry,
        ...(audienceType === "specific_users" ? { userEmails } : {}),
        ...(audienceType === "user_groups" ? { groupNames } : {}),
      }).unwrap();

      const putRes = await fetch(created.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!putRes.ok) throw new Error("upload_failed");

      await finalizeArtifact({ artifactId: created.artifactId }).unwrap();

      dispatch(notify("success", `Published "${file.name}"`));
      resetState();
      onClose();
    } catch {
      setStatus("error");
      dispatch(notify("error", "Failed to publish the file — try again"));
    }
  }

  return (
    <Modal
      open={open}
      title="Publish New Artifact"
      onClose={handleCancel}
      footer={
        step === "file" ? (
          <>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!file}
              onClick={() => setStep("policy")}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              Next
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setStep("file")}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Back
            </button>
            <button
              type="button"
              disabled={status === "uploading"}
              onClick={() => void handlePublish()}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {status === "uploading" ? "Publishing…" : "Publish"}
            </button>
          </>
        )
      }
    >
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
        Step {step === "file" ? "1" : "2"} of 2 — {step === "file" ? "Choose a file" : "Access policy"}
      </p>

      {step === "file" ? (
        <>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />

          {!file ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-3 rounded-md border-2 border-dashed border-neutral-300 py-10 text-sm text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50"
            >
              <img src="/icon-plus.svg" alt="" className="h-10 w-10" />
              Choose a file to upload
            </button>
          ) : (
            <div className="rounded-md border border-neutral-200 p-4 text-sm">
              <p className="font-medium text-neutral-900">{file.name}</p>
              <p className="mt-1 text-neutral-500">
                {formatBytes(file.size)} · {file.type || "unknown type"}
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 text-sm text-neutral-600 underline hover:text-neutral-900"
              >
                Choose a different file
              </button>
            </div>
          )}
        </>
      ) : (
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
          previewBaseDate={new Date().toISOString()}
          disabled={status === "uploading"}
          showValidation={submitAttempted}
        />
      )}
    </Modal>
  );
}
