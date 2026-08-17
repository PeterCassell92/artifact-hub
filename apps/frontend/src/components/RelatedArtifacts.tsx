import { Link } from "react-router-dom";
import { useCreateRelationshipMutation, useDeleteRelationshipMutation, useGetRelationshipsQuery } from "../store/api";
import { useAppDispatch } from "../store/hooks";
import { notify } from "../store/slices/notifications";
import { relationshipLabel } from "../lib/formatters";
import { RelationshipPicker, type RelationshipDraft } from "./RelationshipPicker";

interface RelatedArtifactsProps {
  artifactId: string;
  /** Only the owner of THIS artifact can add/remove OUTGOING relationships from it — matches
   * the owner-of-fromId-only rule everywhere else (MCP link_artifacts/unlink_artifacts, REST).
   * Incoming relationships stay read-only regardless — their `fromId` belongs to another artifact,
   * whose own owner controls them. */
  canManagePolicy: boolean;
}

/**
 * Relationships are authored via MCP (`publish_artifact`'s `relationships`/`link_artifacts`) or,
 * for the owner, right here. A row's `otherArtifact` is null when the caller can't view that side
 * (docs/architecture/06 §2) — shown as "Restricted artifact" rather than hidden, since the
 * relationship itself is still real.
 */
export function RelatedArtifacts({ artifactId, canManagePolicy }: RelatedArtifactsProps) {
  const { data: relationships, isLoading } = useGetRelationshipsQuery(artifactId);
  const [createRelationship] = useCreateRelationshipMutation();
  const [deleteRelationship, { isLoading: isDeleting }] = useDeleteRelationshipMutation();
  const dispatch = useAppDispatch();

  async function handleAdd(draft: RelationshipDraft) {
    try {
      await createRelationship({ artifactId, toId: draft.toId, type: draft.type, note: draft.note }).unwrap();
      dispatch(notify("success", `Linked to "${draft.toTitle}"`));
    } catch {
      dispatch(notify("error", "Failed to link that artifact — try again"));
    }
  }

  async function handleRemove(relationshipId: string) {
    try {
      await deleteRelationship({ artifactId, relationshipId }).unwrap();
    } catch {
      dispatch(notify("error", "Failed to remove that relationship — try again"));
    }
  }

  if (isLoading) {
    return (
      <p className="text-sm text-neutral-500" role="status">
        Loading related artifacts…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!relationships || relationships.length === 0 ? (
        <p className="text-sm text-neutral-500">No related artifacts.</p>
      ) : (
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
              {canManagePolicy && relationship.direction === "outgoing" && (
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => void handleRemove(relationship.id)}
                  aria-label={`Remove relationship to ${relationship.otherArtifact?.title ?? "restricted artifact"}`}
                  className="shrink-0 text-neutral-400 hover:text-red-600 disabled:opacity-50"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManagePolicy && <RelationshipPicker excludeArtifactId={artifactId} onAdd={(draft) => void handleAdd(draft)} />}
    </div>
  );
}
