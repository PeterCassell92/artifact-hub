import { Link } from "react-router-dom";
import type { ArtifactSummary } from "contracts";
import { expiryLabel, formatPublishedAt, kindLabel } from "../lib/formatters";

interface ArtifactListItemProps {
  artifact: ArtifactSummary;
  /** "My Artifacts" shows the audience; "Shared With Me" shows the publisher instead. */
  secondaryLabel: string;
}

export function ArtifactListItem({ artifact, secondaryLabel }: ArtifactListItemProps) {
  return (
    <Link
      to={`/artifacts/${artifact.id}`}
      className="flex items-center justify-between gap-4 rounded-md border border-neutral-200 bg-white p-4 hover:border-neutral-300 hover:shadow-sm"
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-neutral-900">{artifact.title}</p>
        <p className="mt-1 text-sm text-neutral-500">
          {kindLabel(artifact.kind)} · {secondaryLabel} · Published{" "}
          {formatPublishedAt(artifact.publishedAt)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right text-sm">
        <span className={artifact.isExpired ? "text-red-600" : "text-neutral-500"}>
          {expiryLabel(artifact)}
        </span>
        <span className="text-neutral-400">
          {artifact.commentCount} {artifact.commentCount === 1 ? "comment" : "comments"}
        </span>
      </div>
    </Link>
  );
}
