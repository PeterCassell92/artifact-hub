import { Link } from "react-router-dom";
import { useGetRelationshipsQuery } from "../store/api";
import { relationshipLabel } from "../lib/formatters";

/**
 * Read-only — relationships are authored only via MCP (`publish_artifact`'s `relationships` or
 * `link_artifacts`), matching "publishing is MCP-only" (CLAUDE.md). A row's `otherArtifact` is
 * null when the caller can't view that side (docs/architecture/06 §2) — shown as "Restricted
 * artifact" rather than hidden, since the relationship itself is still real.
 */
export function RelatedArtifacts({ artifactId }: { artifactId: string }) {
  const { data: relationships, isLoading } = useGetRelationshipsQuery(artifactId);

  if (isLoading) {
    return (
      <p className="text-sm text-neutral-500" role="status">
        Loading related artifacts…
      </p>
    );
  }

  if (!relationships || relationships.length === 0) {
    return <p className="text-sm text-neutral-500">No related artifacts.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {relationships.map((relationship) => (
        <li
          key={relationship.id}
          className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white p-3 text-sm"
        >
          <div className="min-w-0">
            <span className="mr-2 inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600">
              {relationshipLabel(relationship)}
            </span>
            {relationship.otherArtifact ? (
              <Link
                to={`/artifacts/${relationship.otherArtifact.id}`}
                className="font-medium text-neutral-900 underline hover:text-neutral-700"
              >
                {relationship.otherArtifact.title}
              </Link>
            ) : (
              <span className="text-neutral-500">Restricted artifact</span>
            )}
            {relationship.note && <p className="mt-0.5 truncate text-xs text-neutral-500">{relationship.note}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
