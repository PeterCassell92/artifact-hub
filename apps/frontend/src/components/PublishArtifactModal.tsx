import { useRef, useState } from "react";
import { ArtifactKind, MAX_ARTIFACT_SIZE_BYTES, type AudienceType, type ExpiryOption } from "contracts";
import {
  useCreateArtifactMutation,
  useFinalizeArtifactMutation,
  useListGroupsQuery,
  useListUsersQuery,
} from "../store/api";
import { useAppDispatch } from "../store/hooks";
import { notify } from "../store/slices/notifications";
import { audiencePolicyMissing, fileTypeLabel, formatBytes } from "../lib/formatters";
import { inferKindFromFile } from "../lib/kindFromFile";
import { DEFAULT_LANGUAGE } from "../lib/languages";
import { AccessPolicyFields } from "./AccessPolicyFields";
import { Modal } from "./Modal";
import { PublishMetadataFields } from "./PublishMetadataFields";
import type { RelationshipDraft } from "./RelationshipPicker";

interface PublishArtifactModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = "file" | "metadata" | "policy";

const STEP_LABELS: Record<Step, string> = {
  file: "Choose a file",
  metadata: "Metadata",
  policy: "Access policy",
};
const STEP_ORDER: Step[] = ["file", "metadata", "policy"];

/** The SPA always identifies itself this way — not user-editable, unlike an MCP agent choosing
 * its own `sourceTool` (e.g. "Claude Desktop") when it calls `publish_artifact` directly. */
const SOURCE_TOOL = "frontendSPA";

/**
 * "Publish New Artifact" (Dashboard) — the web-UI publish path, alongside the MCP
 * `publish_artifact` tool. A three-step stepper: pick a file, set its metadata (name, kind, tags,
 * language, relationships — the same fields `publish_artifact` accepts, minus `sourceTool`, which
 * this path fixes to `SOURCE_TOOL` itself), then set its access policy.
 */
export function PublishArtifactModal({ open, onClose }: PublishArtifactModalProps) {
  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ArtifactKind>("other");
  // Tracks whether the publisher has manually changed Kind, so a file re-pick (or the initial
  // pick) can keep auto-suggesting from inferKindFromFile without ever clobbering their choice.
  const [kindTouched, setKindTouched] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [relationships, setRelationships] = useState<RelationshipDraft[]>([]);

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
    setTitle("");
    setKind("other");
    setKindTouched(false);
    setTags([]);
    setLanguage(DEFAULT_LANGUAGE);
    setRelationships([]);
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

  const fileTooLarge = file != null && file.size > MAX_ARTIFACT_SIZE_BYTES;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setStatus("idle");
    // Only default the name from the file the first time — never clobber a name the publisher
    // already edited by re-choosing a file on this same visit to the step.
    if (selected && !title) setTitle(selected.name);
    // Same "don't clobber a deliberate choice" rule for Kind — only auto-suggest while the
    // publisher hasn't touched the Kind field themselves (see `kindTouched`).
    if (selected && !kindTouched) {
      setKind(inferKindFromFile(selected.name, selected.type || "application/octet-stream"));
    }
  }

  async function handlePublish() {
    setSubmitAttempted(true);
    if (!file || emailsMissing || groupsMissing) return;

    setStatus("uploading");
    try {
      const contentType = file.type || "application/octet-stream";
      const created = await createArtifact({
        title: title || file.name,
        fileName: file.name,
        contentType,
        kind,
        tags: tags.length ? tags : undefined,
        sourceTool: SOURCE_TOOL,
        language,
        relationships: relationships.length
          ? relationships.map(({ toId, type, note }) => ({ toId, type, note }))
          : undefined,
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

      dispatch(notify("success", `Published "${title || file.name}"`));
      resetState();
      onClose();
    } catch {
      setStatus("error");
      dispatch(notify("error", "Failed to publish the file — try again"));
    }
  }

  const stepIndex = STEP_ORDER.indexOf(step);

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
              disabled={!file || fileTooLarge}
              onClick={() => setStep("metadata")}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              Next
            </button>
          </>
        ) : step === "metadata" ? (
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
              onClick={() => setStep("policy")}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Next
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setStep("metadata")}
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
        Step {stepIndex + 1} of {STEP_ORDER.length} — {STEP_LABELS[step]}
      </p>

      {step === "file" && (
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
              {fileTooLarge && (
                <p role="alert" className="mt-3 text-sm text-red-600">
                  This file is {formatBytes(file!.size)} — the limit is{" "}
                  {formatBytes(MAX_ARTIFACT_SIZE_BYTES)}. Choose a smaller file.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {step === "metadata" && (
        <PublishMetadataFields
          title={title}
          onTitleChange={setTitle}
          fileType={file ? fileTypeLabel({ fileName: file.name, contentType: file.type || "application/octet-stream" }) : ""}
          kind={kind}
          onKindChange={(value) => {
            setKind(value);
            setKindTouched(true);
          }}
          tags={tags}
          onTagsChange={setTags}
          language={language}
          onLanguageChange={setLanguage}
          relationships={relationships}
          onRelationshipsChange={setRelationships}
        />
      )}

      {step === "policy" && (
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
