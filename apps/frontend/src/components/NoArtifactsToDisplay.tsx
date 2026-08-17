/** Generic empty-state block for a list of artifacts (Dashboard's My Artifacts / Shared With Me
 * sections) — plenty of padding, centered text, no page-specific copy. */
export function NoArtifactsToDisplay() {
  return (
    <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
      No artifacts to display
    </div>
  );
}
