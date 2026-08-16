import { useState } from "react";
import { useGetMyArtifactsQuery } from "../store/api";
import { ArtifactListItem } from "../components/ArtifactListItem";
import { audienceLabel } from "../lib/formatters";

/** Owner's own artifacts (docs/frontend/01 §4). Plain cursor pagination — search/facets are
 * deferred to Phase 7 (docs/development/implementation-plan.md). */
export function MyArtifactsPage() {
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const { data, isLoading, isFetching } = useGetMyArtifactsQuery({ cursor });

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">My Artifacts</h1>
      <p className="mt-1 text-sm text-neutral-600">Everything you&apos;ve published via your agent.</p>

      {isLoading && (
        <p className="mt-6 text-sm text-neutral-500" role="status">
          Loading…
        </p>
      )}

      {!isLoading && data?.items.length === 0 && cursors.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          You haven&apos;t published anything yet. Artifacts are published via your agent (e.g. Claude
          Desktop) using Artifact Hub&apos;s MCP tools — this page is for viewing and managing them.
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {data?.items.map((artifact) => (
          <ArtifactListItem
            key={artifact.id}
            artifact={artifact}
            secondaryLabel={audienceLabel(artifact.audienceType)}
          />
        ))}
      </div>

      {data?.nextCursor && (
        <button
          type="button"
          disabled={isFetching}
          onClick={() => setCursors((prev) => [...prev, data.nextCursor as string])}
          className="mt-4 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {isFetching ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
