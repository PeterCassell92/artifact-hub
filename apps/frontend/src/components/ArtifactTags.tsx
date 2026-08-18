import type { ArtifactTagView } from "contracts";

/** Renders an artifact's tags, marking ones the enrichment job proposed (`source: "ai"`,
 * docs/architecture/01 decision #46) distinctly from human-entered ones — visible to any viewer
 * who can see the artifact at all (tags aren't owner-only, unlike the EnrichmentPanel's job
 * status/rerun controls). */
export function ArtifactTags({ tags }: { tags: ArtifactTagView[] }) {
  if (tags.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li
          key={tag.name}
          title={tag.source === "ai" && tag.confidence !== null ? `AI-suggested (confidence ${Math.round(tag.confidence * 100)}%)` : undefined}
          className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700"
        >
          {tag.name}
          {tag.source === "ai" && (
            <span className="rounded bg-indigo-100 px-1 py-px text-[10px] font-medium text-indigo-700">AI</span>
          )}
        </li>
      ))}
    </ul>
  );
}
