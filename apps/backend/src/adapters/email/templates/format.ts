/** Duplicated from apps/frontend/src/lib/formatters.ts — the backend can't import frontend code.
 * Keep this in sync with the frontend copy if either changes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** Mirrors the frontend's `fileTypeLabel` — extension from `fileName`, falling back to the raw
 * MIME `contentType` when there isn't one. */
export function filetypeLabel(artifact: { fileName: string; contentType: string }): string {
  const extension = /\.([a-zA-Z0-9]+)$/.exec(artifact.fileName)?.[1];
  return extension ? extension.toUpperCase() : artifact.contentType;
}
