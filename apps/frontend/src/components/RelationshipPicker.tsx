import { useEffect, useState } from "react";
import { RelationType } from "contracts";
import { useGetMyArtifactsQuery, useGetSharedWithMeQuery } from "../store/api";
import { relationshipLabel } from "../lib/formatters";

export interface RelationshipDraft {
  toId: string;
  toTitle: string;
  type: RelationType;
  note?: string;
}

interface RelationshipPickerProps {
  /** Excluded from search results — an artifact can't be related to itself. Omit while
   * publishing (the new artifact has no id yet). */
  excludeArtifactId?: string;
  onAdd: (relationship: RelationshipDraft) => void;
  disabled?: boolean;
}

/**
 * Search-and-add control for linking one artifact to another — shared by PublishArtifactModal's
 * metadata step (stages drafts locally, submitted with the publish) and RelatedArtifacts on the
 * artifact detail page (adds immediately via createRelationship). Always creates an OUTGOING
 * relationship from the artifact being edited/published, so type labels read from that side
 * (`relationshipLabel(..., "outgoing")`).
 */
export function RelationshipPicker({ excludeArtifactId, onAdd, disabled = false }: RelationshipPickerProps) {
  const [scope, setScope] = useState<"mine" | "sharedWithMe">("mine");
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<{ id: string; title: string } | null>(null);
  const [type, setType] = useState<RelationType>("related_to");
  const [note, setNote] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(handle);
  }, [searchText]);

  const mine = useGetMyArtifactsQuery({ q: debouncedSearch || undefined, limit: 10 }, { skip: scope !== "mine" });
  const shared = useGetSharedWithMeQuery(
    { q: debouncedSearch || undefined, limit: 10 },
    { skip: scope !== "sharedWithMe" },
  );
  const results = (scope === "mine" ? mine.data : shared.data)?.items.filter(
    (a) => a.id !== excludeArtifactId,
  );

  function handleAdd() {
    if (!selected) return;
    onAdd({ toId: selected.id, toTitle: selected.title, type, note: note.trim() || undefined });
    setSelected(null);
    setSearchText("");
    setNote("");
    setType("related_to");
  }

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 text-sm">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Link another artifact
      </legend>

      <div className="flex gap-2">
        <select
          aria-label="Search scope"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as "mine" | "sharedWithMe");
            setSelected(null);
          }}
          className="rounded-md border border-neutral-300 px-2 py-1.5"
        >
          <option value="mine">My Artifacts</option>
          <option value="sharedWithMe">Shared With Me</option>
        </select>
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search by title…"
          aria-label="Search artifacts to link"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5"
        />
      </div>

      {results && results.length > 0 && (
        <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border border-neutral-300 px-3 py-1.5">
          {results.map((artifact) => (
            <label key={artifact.id} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="relationship-target"
                checked={selected?.id === artifact.id}
                onChange={() => setSelected({ id: artifact.id, title: artifact.title })}
              />
              {artifact.title}
            </label>
          ))}
        </div>
      )}
      {results && results.length === 0 && debouncedSearch && (
        <p className="text-neutral-500">No matching artifacts.</p>
      )}

      {selected && (
        <div className="flex flex-col gap-2 border-t border-neutral-200 pt-2">
          <p className="text-neutral-700">
            <span className="font-medium">{selected.title}</span> —{" "}
            <button type="button" onClick={() => setSelected(null)} className="underline">
              change
            </button>
          </p>
          <label className="flex flex-col gap-1">
            Relationship type
            <select
              value={type}
              onChange={(e) => setType(e.target.value as RelationType)}
              className="rounded-md border border-neutral-300 px-3 py-1.5"
            >
              {RelationType.options.map((option) => (
                <option key={option} value={option}>
                  {relationshipLabel({ type: option, direction: "outgoing" })}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Note (optional)
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={280}
              placeholder="e.g. post-processed export"
              className="rounded-md border border-neutral-300 px-3 py-1.5"
            />
          </label>
          <button
            type="button"
            onClick={handleAdd}
            className="self-start rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Add relationship
          </button>
        </div>
      )}
    </fieldset>
  );
}
