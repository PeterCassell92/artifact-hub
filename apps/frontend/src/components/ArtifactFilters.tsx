import { useEffect, useState } from "react";
import { ArtifactKind, AudienceType } from "contracts";
import type { ArtifactFacetOptions } from "contracts";
import type { ArtifactListFilters } from "../store/api";
import { audienceLabel, kindLabel, sortLabel } from "../lib/formatters";

const SORT_OPTIONS: ArtifactListFilters["sort"][] = ["published", "title", "lastAccessed", "size"];

const SINCE_HOURS_OPTIONS: { value: number | undefined; label: string }[] = [
  { value: undefined, label: "Any time" },
  { value: 24, label: "Last 24 hours" },
  { value: 24 * 7, label: "Last 7 days" },
  { value: 24 * 30, label: "Last 30 days" },
];

function toggle<T extends string>(list: T[] | undefined, item: T): T[] | undefined {
  const set = new Set(list ?? []);
  if (set.has(item)) set.delete(item);
  else set.add(item);
  return set.size ? Array.from(set) : undefined;
}

interface CheckboxGroupProps<T extends string> {
  label: string;
  options: readonly T[];
  selected: T[] | undefined;
  labelFor?: (value: T) => string;
  onChange: (next: T[] | undefined) => void;
}

function CheckboxGroup<T extends string>({ label, options, selected, labelFor, onChange }: CheckboxGroupProps<T>) {
  if (options.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-1.5 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={(selected ?? []).includes(option)}
              onChange={() => onChange(toggle(selected, option))}
            />
            {labelFor ? labelFor(option) : option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface ArtifactFiltersProps {
  /** "My Artifacts" shows audience/access-state facets; "Shared With Me" shows publisher/shared-
   * window facets instead — mirrors ArtifactListItem's own scope-conditional secondary label. */
  scope: "mine" | "sharedWithMe";
  value: ArtifactListFilters;
  onChange: (next: ArtifactListFilters) => void;
  /** Distinct facet option values for this scope (`GET /api/artifacts/facets`) — undefined while
   * loading, in which case the facet checkbox groups that depend on it are simply not rendered. */
  facets?: ArtifactFacetOptions;
}

/** Search box + facet controls + sort (docs/frontend/02) shared by MyArtifactsPage and
 * SharedWithMePage. Fully controlled — the page owns the filter state (reflected in the URL) and
 * passes it down; this component only ever calls `onChange` with the next full filter object. */
export function ArtifactFilters({ scope, value, onChange, facets }: ArtifactFiltersProps) {
  const [searchText, setSearchText] = useState(value.q ?? "");

  // Keep the input in sync if the filters change from outside (e.g. a "clear filters" action).
  useEffect(() => {
    setSearchText(value.q ?? "");
  }, [value.q]);

  // Debounced so search doesn't refetch on every keystroke (docs/frontend/02 §1).
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchText !== (value.q ?? "")) {
        onChange({ ...value, q: searchText || undefined });
      }
    }, 300);
    return () => clearTimeout(handle);
    // Only re-run when the debounced text itself changes — including `value`/`onChange` here
    // would fire on every parent re-render and defeat the debounce.
  }, [searchText]);

  return (
    <div className="flex flex-col gap-4 rounded-md border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-sm text-neutral-700">
          Search
          <input
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Title, description, filename, or tag"
            className="rounded-md border border-neutral-300 px-3 py-1.5"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-neutral-700">
          Sort
          <select
            value={value.sort}
            onChange={(e) => onChange({ ...value, sort: e.target.value as ArtifactListFilters["sort"] })}
            className="rounded-md border border-neutral-300 px-3 py-1.5"
          >
            {SORT_OPTIONS.map((sort) => (
              <option key={sort} value={sort}>
                {sortLabel(sort as NonNullable<ArtifactListFilters["sort"]>)}
              </option>
            ))}
          </select>
        </label>

        {scope === "sharedWithMe" && (
          <label className="flex flex-col gap-1 text-sm text-neutral-700">
            Shared window
            <select
              value={value.sinceHours ?? ""}
              onChange={(e) =>
                onChange({ ...value, sinceHours: e.target.value ? Number(e.target.value) : undefined })
              }
              className="rounded-md border border-neutral-300 px-3 py-1.5"
            >
              {SINCE_HOURS_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value ?? ""}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {scope === "mine" && (
          <label className="flex flex-col gap-1 text-sm text-neutral-700">
            Access state
            <select
              value={value.isExpired === undefined ? "" : String(value.isExpired)}
              onChange={(e) =>
                onChange({
                  ...value,
                  isExpired: e.target.value === "" ? undefined : e.target.value === "true",
                })
              }
              className="rounded-md border border-neutral-300 px-3 py-1.5"
            >
              <option value="">Any</option>
              <option value="false">Active</option>
              <option value="true">Expired</option>
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <CheckboxGroup
          label="Kind"
          options={ArtifactKind.options}
          selected={value.kind}
          labelFor={kindLabel}
          onChange={(kind) => onChange({ ...value, kind })}
        />

        {scope === "mine" && (
          <CheckboxGroup
            label="Audience"
            options={AudienceType.options}
            selected={value.audienceType}
            labelFor={audienceLabel}
            onChange={(audienceType) => onChange({ ...value, audienceType })}
          />
        )}

        {facets && (
          <>
            <CheckboxGroup
              label="File type"
              options={facets.contentTypes}
              selected={value.contentType}
              onChange={(contentType) => onChange({ ...value, contentType })}
            />
            <CheckboxGroup
              label="Tags"
              options={facets.tags}
              selected={value.tags}
              onChange={(tags) => onChange({ ...value, tags })}
            />
            <CheckboxGroup
              label="Source tool"
              options={facets.sourceTools}
              selected={value.sourceTool}
              onChange={(sourceTool) => onChange({ ...value, sourceTool })}
            />
            {scope === "sharedWithMe" && (
              <CheckboxGroup
                label="Publisher"
                options={facets.publishers.map((p) => p.id)}
                selected={value.publisherId}
                labelFor={(id) => facets.publishers.find((p) => p.id === id)?.name ?? "Unknown"}
                onChange={(publisherId) => onChange({ ...value, publisherId })}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
