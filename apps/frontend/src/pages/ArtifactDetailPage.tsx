import { Link, useNavigate, useParams } from "react-router-dom";
import { useGetArtifactQuery } from "../store/api";
import { ArtifactViewer } from "../components/ArtifactViewer";
import { ArtifactTags } from "../components/ArtifactTags";
import { CommentForm } from "../components/CommentForm";
import { ConversationSummary } from "../components/ConversationSummary";
import { CommentList } from "../components/CommentList";
import { AccessHistoryPanel } from "../components/AccessHistoryPanel";
import { AccessPolicyEditor } from "../components/AccessPolicyEditor";
import { AccessPolicySummary } from "../components/AccessPolicySummary";
import { EnrichmentPanel } from "../components/EnrichmentPanel";
import { RelatedArtifacts } from "../components/RelatedArtifacts";
import { ShareLinkPanel } from "../components/ShareLinkPanel";
import { fileTypeLabel, formatBytes, formatPublishedAtWithTime, kindLabel } from "../lib/formatters";

/** Gated by canView server-side; 403/404 render inline "access ended"/"not found" states rather
 * than a crash — this is the live-revocation UX docs/frontend/01 §8 calls for. */
export function ArtifactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: artifact, isLoading, error } = useGetArtifactQuery(id ?? "", { skip: !id });

  const backButton = (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className="self-start whitespace-nowrap text-sm text-neutral-600 underline hover:text-neutral-900"
    >
      ← Back
    </button>
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {backButton}
        <p className="text-sm text-neutral-500" role="status">
          Loading…
        </p>
      </div>
    );
  }

  if (error && "status" in error && error.status === 403) {
    return (
      <div className="flex flex-col gap-4">
        {backButton}
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <p className="text-neutral-900">You no longer have access to this artifact.</p>
          <Link to="/" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (error || !artifact) {
    return (
      <div className="flex flex-col gap-4">
        {backButton}
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <p className="text-neutral-900">Artifact not found.</p>
          <Link to="/" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-6">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">{artifact.title}</h1>
          {artifact.description && <p className="mt-1 text-sm text-neutral-600">{artifact.description}</p>}
        </div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="shrink-0 whitespace-nowrap text-sm leading-7 text-neutral-600 underline hover:text-neutral-900"
        >
          ← Back
        </button>
      </div>

      <ArtifactViewer artifact={artifact} />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-neutral-200 bg-white p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-neutral-500">Kind</dt>
          <dd className="text-neutral-800">{kindLabel(artifact.kind)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">File type</dt>
          <dd className="text-neutral-800">{fileTypeLabel(artifact)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Size</dt>
          <dd className="text-neutral-800">{formatBytes(artifact.sizeBytes)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Published</dt>
          <dd className="text-neutral-800">{formatPublishedAtWithTime(artifact.publishedAt)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Publisher</dt>
          <dd className="text-neutral-800">{artifact.publisherName ?? "Unknown"}</dd>
        </div>
      </dl>

      {(artifact.tags.length > 0 || artifact.aiSummary || artifact.conversationSummary) && (
        <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-4 text-sm">
          {artifact.aiSummary && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">AI Summary</h2>
              <p className="mt-1 text-neutral-800">{artifact.aiSummary}</p>
              {artifact.aiTopics.length > 0 && (
                <p className="mt-1 text-xs text-neutral-500">Topics: {artifact.aiTopics.join(", ")}</p>
              )}
            </div>
          )}
          {artifact.conversationSummary && (
            <ConversationSummary
              summary={artifact.conversationSummary}
              messageCount={artifact.conversationMessageCount}
              firstMessageDateTime={artifact.conversationFirstMessageAt}
              finalMessageDateTime={artifact.conversationFinalMessageAt}
            />
          )}
          {artifact.tags.length > 0 && <ArtifactTags tags={artifact.tags} />}
        </div>
      )}

      {/* Reaching this point at all means the server's canView already passed (403s render their
          own early-return state above) — so any viewer here, owner or not, is safe to hand out a
          share link (03 §5: it's a pure locator, never more permissive than their own access). */}
      <div className="grid gap-4 sm:grid-cols-2">
        {artifact.canManagePolicy ? (
          <AccessPolicyEditor artifact={artifact} />
        ) : (
          <AccessPolicySummary artifact={artifact} />
        )}
        <ShareLinkPanel artifactId={artifact.id} />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-700">Related Artifacts</h2>
        <div className="mt-3">
          <RelatedArtifacts artifactId={artifact.id} canManagePolicy={artifact.canManagePolicy} />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-700">Comments</h2>
        <div className="mt-3">
          <CommentForm artifactId={artifact.id} />
        </div>
        <div className="mt-4">
          <CommentList artifactId={artifact.id} />
        </div>
      </div>

      {artifact.canManagePolicy && (
        <div>
          <h2 className="text-sm font-semibold text-neutral-700">AI Enrichment</h2>
          <div className="mt-3">
            <EnrichmentPanel artifactId={artifact.id} />
          </div>
        </div>
      )}

      {artifact.canViewAccessEvents && (
        <div>
          <h2 className="text-sm font-semibold text-neutral-700">Access History</h2>
          <div className="mt-3">
            <AccessHistoryPanel artifactId={artifact.id} />
          </div>
        </div>
      )}
    </div>
  );
}
