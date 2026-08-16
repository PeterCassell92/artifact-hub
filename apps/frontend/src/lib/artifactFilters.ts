import type { ArtifactListFilters } from "../store/api";

/** Reads filter state back out of the URL (docs/frontend/02 §2: "active filters reflected in the
 * URL — shareable/bookmarkable"). Array-valued filters are read as one comma-joined value,
 * matching how `serializeArtifactFilters` writes them and how the backend's `csvParam` parses
 * them (packages/contracts/src/artifact.ts). */
export function parseArtifactFilters(params: URLSearchParams): ArtifactListFilters {
  const filters: ArtifactListFilters = {};

  const q = params.get("q");
  if (q) filters.q = q;

  const sort = params.get("sort");
  if (sort) filters.sort = sort as ArtifactListFilters["sort"];

  const contentType = params.get("contentType");
  if (contentType) filters.contentType = contentType.split(",");

  const kind = params.get("kind");
  if (kind) filters.kind = kind.split(",") as NonNullable<ArtifactListFilters["kind"]>;

  const tags = params.get("tags");
  if (tags) filters.tags = tags.split(",");

  const sourceTool = params.get("sourceTool");
  if (sourceTool) filters.sourceTool = sourceTool.split(",");

  const audienceType = params.get("audienceType");
  if (audienceType) {
    filters.audienceType = audienceType.split(",") as NonNullable<ArtifactListFilters["audienceType"]>;
  }

  const publisherId = params.get("publisherId");
  if (publisherId) filters.publisherId = publisherId.split(",");

  const sinceHours = params.get("sinceHours");
  if (sinceHours) filters.sinceHours = Number(sinceHours);

  const isExpired = params.get("isExpired");
  if (isExpired !== null) filters.isExpired = isExpired === "true";

  return filters;
}

/** Writes filter state into `URLSearchParams`-compatible params, omitting defaults/empties so the
 * URL stays clean when no filter is active. */
export function serializeArtifactFilters(filters: ArtifactListFilters): Record<string, string> {
  const out: Record<string, string> = {};

  if (filters.q) out.q = filters.q;
  if (filters.sort && filters.sort !== "published") out.sort = filters.sort;
  if (filters.sinceHours) out.sinceHours = String(filters.sinceHours);
  if (filters.isExpired !== undefined) out.isExpired = String(filters.isExpired);

  if (filters.contentType?.length) out.contentType = filters.contentType.join(",");
  if (filters.kind?.length) out.kind = filters.kind.join(",");
  if (filters.tags?.length) out.tags = filters.tags.join(",");
  if (filters.sourceTool?.length) out.sourceTool = filters.sourceTool.join(",");
  if (filters.audienceType?.length) out.audienceType = filters.audienceType.join(",");
  if (filters.publisherId?.length) out.publisherId = filters.publisherId.join(",");

  return out;
}
