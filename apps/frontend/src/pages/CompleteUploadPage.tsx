import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useFinalizeArtifactMutation,
  useGetArtifactQuery,
  useReissueUploadUrlMutation,
} from "../store/api";
import { useAppDispatch } from "../store/hooks";
import { notify } from "../store/slices/notifications";
import { formatBytes } from "../lib/formatters";

/**
 * /artifacts/:id/complete-upload — finishes an MCP-started publish in the browser (01 decision
 * #47): `publish_artifact` sets all metadata + policy up front, so when the agent's host has no
 * HTTP capability to PUT the bytes itself (e.g. Claude Desktop), the user opens this page from
 * the tool's webUploadUrl and only picks the file — the page re-mints a fresh presigned PUT
 * (the original expires in ~5 min), uploads, and finalizes. Deliberately NOT the Dashboard's
 * publish modal: no metadata or policy steps, those already happened. The URL is an id-only
 * locator with no secret — ProtectedRoute's session auth plus the ownership checks here and on
 * the backend are the actual gate. Also serves as the resume path for any abandoned pending
 * upload, SPA- or MCP-originated.
 */
export function CompleteUploadPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { data: artifact, isLoading, error } = useGetArtifactQuery(id ?? "", { skip: !id });
  const [reissueUploadUrl] = useReissueUploadUrlMutation();
  const [finalizeArtifact] = useFinalizeArtifactMutation();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");

  if (isLoading) {
    return (
      <p className="text-sm text-neutral-500" role="status">
        Loading…
      </p>
    );
  }

  if (error || !artifact) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-neutral-900" role="alert">
          Artifact not found, or you don't have access to it.
        </p>
        <Link to="/" className="text-sm text-neutral-600 underline hover:text-neutral-900">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  if (!artifact.canManagePolicy) {
    return (
      <p className="text-neutral-900" role="alert">
        Only the publisher can finish this upload.
      </p>
    );
  }

  if (artifact.sizeBytes > 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-neutral-900">"{artifact.title}" has already finished uploading.</p>
        <Link
          to={`/artifacts/${artifact.id}`}
          className="self-start text-sm text-neutral-600 underline hover:text-neutral-900"
        >
          View artifact
        </Link>
      </div>
    );
  }

  async function handleUpload() {
    if (!file || !artifact) return;

    setStatus("uploading");
    try {
      let uploadUrl: string;
      try {
        ({ uploadUrl } = await reissueUploadUrl(artifact.id).unwrap());
      } catch (reissueErr) {
        // 409: the artifact was finalized elsewhere after this page loaded (the agent's own
        // curl, or a second tab) — that's completion, not a failure, so don't say "try again".
        if ((reissueErr as { status?: number }).status === 409) {
          dispatch(notify("success", `"${artifact.title}" has already finished uploading`));
          navigate(`/artifacts/${artifact.id}`, { replace: true });
          return;
        }
        throw reissueErr;
      }
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        // Must be the artifact's *stored* contentType — what the presigned URL was signed with
        // at publish_artifact time — not this freshly-picked file's `file.type`; a mismatch
        // fails the storage signature check.
        headers: { "Content-Type": artifact.contentType },
        body: file,
      });
      if (!putRes.ok) throw new Error("upload_failed");

      await finalizeArtifact({ artifactId: artifact.id }).unwrap();

      dispatch(notify("success", `Published "${artifact.title}"`));
      navigate(`/artifacts/${artifact.id}`, { replace: true });
    } catch {
      setStatus("error");
      dispatch(notify("error", "Failed to finish the upload — try again"));
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">
          Finish publishing "{artifact.title}"
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          The metadata and access policy are already set — just choose the file ({artifact.fileName})
          to upload it and publish.
        </p>
      </div>

      <input
        type="file"
        aria-label="Choose the file to upload"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="text-sm text-neutral-700"
      />
      {file && (
        <p className="text-sm text-neutral-500">
          {file.name} · {formatBytes(file.size)}
        </p>
      )}

      <button
        type="button"
        disabled={!file || status === "uploading"}
        onClick={() => void handleUpload()}
        className="self-start rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {status === "uploading" ? "Uploading…" : "Upload and publish"}
      </button>
    </div>
  );
}
