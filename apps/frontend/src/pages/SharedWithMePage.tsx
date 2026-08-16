import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useGetArtifactFacetsQuery, useGetSharedWithMeQuery, type ArtifactListFilters } from "../store/api";
import { ArtifactFilters } from "../components/ArtifactFilters";
import { ArtifactListItem } from "../components/ArtifactListItem";
import { parseArtifactFilters, serializeArtifactFilters } from "../lib/artifactFilters";

function hasActiveFilters(filters: ArtifactListFilters): boolean {
  return Boolean(
    filters.q ||
      (filters.sort && filters.sort !== "published") ||
      filters.kind?.length ||
      filters.contentType?.length ||
      filters.tags?.length ||
      filters.sourceTool?.length ||
      filters.publisherId?.length ||
      filters.sinceHours,
  );
}

/** Artifacts shared to me directly or via my groups (docs/frontend/01 §5), mirroring the MCP
 * `list_shared_with_me` tool, with the full search/facet/sort surface (Phase 7) including the
 * "shared window" quick presets. Filter state lives in the URL so the view is shareable. */
export function SharedWithMePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseArtifactFilters(searchParams), [searchParams]);
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const { data, isLoading, isFetching } = useGetSharedWithMeQuery({ ...filters, cursor });
  const { data: facets } = useGetArtifactFacetsQuery({ scope: "sharedWithMe" });

  function handleFiltersChange(next: ArtifactListFilters) {
    setCursors([]);
    setSearchParams(serializeArtifactFilters(next), { replace: true });
  }

  const filtered = hasActiveFilters(filters);

  return (
    <div>
      <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
        Shared With Me
        <img src="/icon-handshake.svg" alt="" className="h-6 w-6" />
      </h1>
      <p className="mt-1 text-sm text-neutral-600">Artifacts others have shared to you or your groups.</p>

      <div className="mt-4">
        <ArtifactFilters scope="sharedWithMe" value={filters} onChange={handleFiltersChange} facets={facets} />
      </div>

      {isLoading && (
        <p className="mt-6 text-sm text-neutral-500" role="status">
          Loading…
        </p>
      )}

      {!isLoading && data?.items.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          {filtered ? "No artifacts match these filters." : "Nothing has been shared with you yet."}
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
