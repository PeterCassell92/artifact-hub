import type { ArtifactKind } from "contracts";

/** Inline-safe glyphs, one per artifact kind — no icon-image pipeline exists anywhere in the repo
 * today, so this is built fresh and kept intentionally minimal (no asset loading, works even with
 * images blocked by default in most email clients). */
const KIND_ICONS: Record<ArtifactKind, string> = {
  diagram: "🗺️",
  document: "📄",
  image: "🖼️",
  report: "📈",
  data: "🗃️",
  other: "📎",
};

export function artifactKindIcon(kind: ArtifactKind): string {
  return KIND_ICONS[kind];
}

export function kindLabel(kind: ArtifactKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
