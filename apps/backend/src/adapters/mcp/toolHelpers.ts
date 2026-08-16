import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Tool-level failure (auth/not-found/validation) — surfaced as `isError`, not a JSON-RPC error,
 * so the agent sees it in the transcript and can react (per MCP convention). */
export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Metadata-only result: JSON for programmatic use, optionally preceded by a human-readable summary
 * (or a markdown table) — every Artifact Hub tool result follows this shape (docs/architecture/05 §3/§4). */
export function toolJson(payload: unknown, ...extraText: string[]): CallToolResult {
  const content: CallToolResult["content"] = extraText.map((text) => ({ type: "text" as const, text }));
  content.push({ type: "text", text: JSON.stringify(payload, null, 2) });
  return { content };
}

/** 512KB — the "small" threshold for `get_artifact` inline content (docs/architecture/05 §4). */
export const SMALL_CONTENT_MAX_BYTES = 512 * 1024;

export type ArtifactContentPresentation = "image" | "embedded_text" | "embedded_blob" | "pointer";

function isTextLike(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/xml" ||
    contentType.endsWith("+json") ||
    contentType.endsWith("+xml")
  );
}

/** How `get_artifact` should present a given artifact's bytes (docs/architecture/05 §4:
 * "small image → image block; small text/PDF → embedded resource; else → pointer"). */
export function classifyArtifactContent(contentType: string, sizeBytes: number): ArtifactContentPresentation {
  if (sizeBytes > SMALL_CONTENT_MAX_BYTES) return "pointer";
  if (contentType.startsWith("image/")) return "image";
  if (isTextLike(contentType)) return "embedded_text";
  return "embedded_blob";
}
