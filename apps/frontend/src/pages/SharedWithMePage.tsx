import { useState } from "react";
import { useGetSharedWithMeQuery } from "../store/api";
import { ArtifactListItem } from "../components/ArtifactListItem";

/** Artifacts shared to me directly or via my groups (docs/frontend/01 §5), mirroring the MCP
 * `list_shared_with_me` tool, incl. its "last 24 hours" quick filter. */
export function SharedWithMePage() {
  const [last24h, setLast24h] = useState(false);
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const { data, isLoading, isFetching } = useGetSharedWithMeQuery({
    sinceHours: last24h ? 24 : undefined,
    cursor,
  });

  function toggleLast24h() {
    setCursors([]);
    setLast24h((prev) => !prev);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Shared With Me</h1>
          <p className="mt-1 text-sm text-neutral-600">Artifacts others have shared to you or your groups.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={last24h} onChange={toggleLast24h} />
          Last 24 hours
        </label>
      </div>

      {isLoading && (
        <p className="mt-6 text-sm text-neutral-500" role="status">
          Loading…
        </p>
      )}

      {!isLoading && data?.items.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          {last24h ? "Nothing shared with you in the last 24 hours." : "Nothing has been shared with you yet."}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {data?.items.map((artifact) => (
          <ArtifactListItem
            key={artifact.id}
            artifact={artifact}
            secondaryLabel={artifact.publisherName ?? "Unknown publisher"}
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
