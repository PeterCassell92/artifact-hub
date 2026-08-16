import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useGetArtifactFacetsQuery, useGetMyArtifactsQuery, type ArtifactListFilters } from "../store/api";
import { ArtifactFilters } from "../components/ArtifactFilters";
import { ArtifactListItem } from "../components/ArtifactListItem";
import { audienceLabel } from "../lib/formatters";
import { parseArtifactFilters, serializeArtifactFilters } from "../lib/artifactFilters";

function hasActiveFilters(filters: ArtifactListFilters): boolean {
  return Boolean(
    filters.q ||
      (filters.sort && filters.sort !== "published") ||
      filters.kind?.length ||
      filters.contentType?.length ||
      filters.tags?.length ||
      filters.sourceTool?.length ||
      filters.audienceType?.length ||
      filters.isExpired !== undefined,
  );
}

/** Owner's own artifacts (docs/frontend/01 §4), with the full search/facet/sort surface
 * (implementation-plan.md Phase 7) — filter state lives in the URL so the view is shareable. */
export function MyArtifactsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseArtifactFilters(searchParams), [searchParams]);
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const { data, isLoading, isFetching } = useGetMyArtifactsQuery({ ...filters, cursor });
  const { data: facets } = useGetArtifactFacetsQuery({ scope: "mine" });

  function handleFiltersChange(next: ArtifactListFilters) {
    setCursors([]);
    setSearchParams(serializeArtifactFilters(next), { replace: true });
  }

  const filtered = hasActiveFilters(filters);

  return (
    <div>
      <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
        My Artifacts
        <img src="/icon-diamond.svg" alt="" className="h-5 w-5" />
      </h1>
      <p className="mt-1 text-sm text-neutral-600">Everything you&apos;ve published via your agent.</p>

      <div className="mt-4">
        <ArtifactFilters scope="mine" value={filters} onChange={handleFiltersChange} facets={facets} />
      </div>

      {isLoading && (
        <p className="mt-6 text-sm text-neutral-500" role="status">
          Loading…
        </p>
      )}

      {!isLoading && data?.items.length === 0 && !filtered && (
        <div className="mt-6 rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          You haven&apos;t published anything yet. Artifacts are published via your agent (e.g. Claude
          Desktop) using Artifact Hub&apos;s MCP tools — this page is for viewing and managing them.
        </div>
      )}

      {!isLoading && data?.items.length === 0 && filtered && (
        <div className="mt-6 rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No artifacts match these filters.
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
