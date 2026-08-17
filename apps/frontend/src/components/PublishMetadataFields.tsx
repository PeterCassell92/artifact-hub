import { useState } from "react";
import { ArtifactKind } from "contracts";
import { kindLabel } from "../lib/formatters";
import { LANGUAGE_OPTIONS } from "../lib/languages";
import { RelationshipPicker, type RelationshipDraft } from "./RelationshipPicker";

interface PublishMetadataFieldsProps {
  title: string;
  onTitleChange: (value: string) => void;
  /** Derived from the chosen file (extension, falling back to contentType) — read-only, same
   * source as the artifact detail page's "File type" row (`fileTypeLabel`). */
  fileType: string;
  kind: ArtifactKind;
  onKindChange: (value: ArtifactKind) => void;
  tags: string[];
  onTagsChange: (value: string[]) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  relationships: RelationshipDraft[];
  onRelationshipsChange: (value: RelationshipDraft[]) => void;
  disabled?: boolean;
}

function TagInput({
  tags,
  onChange,
  disabled,
}: {
  tags: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function addTag() {
    const value = draft.trim();
    if (value && !tags.includes(value)) onChange([...tags, value]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="publish-tags">Tags</label>
      <div className="flex gap-2">
        <input
          id="publish-tags"
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="Type a tag, press Enter"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 disabled:bg-neutral-100"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={addTag}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700"
            >
              {tag}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                aria-label={`Remove tag ${tag}`}
                className="text-neutral-400 hover:text-red-600"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * PublishArtifactModal's metadata step — the SPA-publish equivalent of `publish_artifact`'s
 * `kind`/`tags`/`language`/`relationships` arguments (docs/architecture/05 §4), so a human
 * publisher gets the same classification/linking power an agent has. `sourceTool` is deliberately
 * absent here — the SPA always sends `sourceTool: "frontendSPA"` itself rather than asking the
 * publisher, since it isn't a choice a human makes the way an agent identifies itself. `format`
 * doesn't exist as an artifact field at all (removed — file type + kind + tags cover it).
 * Relationships are staged locally (the artifact doesn't exist yet) and created server-side
 * alongside it.
 */
export function PublishMetadataFields({
  title,
  onTitleChange,
  fileType,
  kind,
  onKindChange,
  tags,
  onTagsChange,
  language,
  onLanguageChange,
  relationships,
  onRelationshipsChange,
  disabled = false,
}: PublishMetadataFieldsProps) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        Name
        <input
          type="text"
          value={title}
          disabled={disabled}
          onChange={(e) => onTitleChange(e.target.value)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:bg-neutral-100"
        />
      </label>

      <div className="flex flex-col gap-1">
        <span id="publish-file-type-label">File type</span>
        <p
          aria-labelledby="publish-file-type-label"
          className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-neutral-600"
        >
          {fileType}
        </p>
      </div>

      <label className="flex flex-col gap-1">
        Kind
        <select
          value={kind}
          disabled={disabled}
          onChange={(e) => onKindChange(e.target.value as ArtifactKind)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:bg-neutral-100"
        >
          {ArtifactKind.options.map((option) => (
            <option key={option} value={option}>
              {kindLabel(option)}
            </option>
          ))}
        </select>
      </label>

      <TagInput tags={tags} onChange={onTagsChange} disabled={disabled} />

      <label className="flex flex-col gap-1">
        Language
        <select
          value={language}
          disabled={disabled}
          onChange={(e) => onLanguageChange(e.target.value)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:bg-neutral-100"
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {relationships.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {relationships.map((relationship, index) => (
            <li
              key={`${relationship.toId}-${relationship.type}`}
              className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 px-3 py-1.5"
            >
              <span>
                <span className="mr-2 inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600">
                  {relationship.type}
                </span>
                {relationship.toTitle}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRelationshipsChange(relationships.filter((_, i) => i !== index))}
                aria-label={`Remove relationship to ${relationship.toTitle}`}
                className="shrink-0 text-neutral-400 hover:text-red-600"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <RelationshipPicker
        disabled={disabled}
        onAdd={(draft) => onRelationshipsChange([...relationships, draft])}
      />
    </div>
  );
}
