/** Shared by `adapters/mcp/toolHelpers.ts` (inline-content presentation) and
 * `workers/handlers/artifactEnrich.ts` (gating whether an artifact is eligible for enrichment at
 * all) — one definition of "text-like" for both. Deliberately generous: false negatives here
 * silently exclude a legitimately-text artifact from enrichment (as `application/octet-stream`
 * did before `inferContentType` below), so when in doubt this errs toward matching. */
export function isTextLike(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/xml" ||
    contentType === "application/yaml" ||
    contentType === "application/x-yaml" ||
    contentType === "application/toml" ||
    contentType === "application/sql" ||
    contentType === "application/jsonl" ||
    contentType === "application/x-ndjson" ||
    contentType === "application/x-jsonlines" ||
    contentType === "application/javascript" ||
    contentType === "application/x-sh" ||
    contentType === "application/x-shellscript" ||
    contentType.endsWith("+json") ||
    contentType.endsWith("+xml") ||
    contentType.endsWith("+yaml")
  );
}

/** Declared content types carrying essentially no information — a browser or MCP client's
 * catch-all for "I don't know what this is", not a real signal to trust over the file extension. */
const LOW_CONFIDENCE_CONTENT_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-binary",
  "application/unknown",
]);

/** Extension (lowercased, no dot) -> a specific content type — covers common text/data/code
 * formats that browsers and MCP clients routinely fail to identify (`file.type` comes back empty
 * for `.jsonl` in every major browser, for example), used only as a fallback when the declared
 * content type is itself uninformative (see `LOW_CONFIDENCE_CONTENT_TYPES`). Mirrors
 * apps/frontend/src/lib/kindFromFile.ts's extension table where the two overlap (e.g. `text/x-mermaid`
 * for `.mmd`), but is about the stored MIME type, not the display `kind`. */
const EXTENSION_CONTENT_TYPE: Record<string, string> = {
  jsonl: "application/jsonl",
  ndjson: "application/jsonl",
  md: "text/markdown",
  markdown: "text/markdown",
  mmd: "text/x-mermaid",
  mermaid: "text/x-mermaid",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  log: "text/plain",
  ini: "text/plain",
  cfg: "text/plain",
  conf: "text/plain",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  svg: "image/svg+xml",
  sql: "application/sql",
  sh: "application/x-sh",
  bash: "application/x-sh",
  py: "text/x-python",
  rb: "text/x-ruby",
  go: "text/x-go",
  rs: "text/x-rust",
  java: "text/x-java",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c",
  hpp: "text/x-c",
  ts: "application/typescript",
  tsx: "application/typescript",
  js: "application/javascript",
  jsx: "application/javascript",
  mjs: "application/javascript",
  cjs: "application/javascript",
};

function extensionOf(fileName: string): string | undefined {
  return /\.([a-zA-Z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase();
}

/**
 * Corrects an uninformative declared content type (see `LOW_CONFIDENCE_CONTENT_TYPES`) using the
 * file extension, so a `.jsonl`/`.md`/`.py`/etc. upload doesn't get permanently stuck as
 * `application/octet-stream` just because the publishing client (browser or MCP agent) didn't
 * know its MIME type. Called once, server-side, at the single point both publish paths converge
 * on (`createArtifactPending`) — never overrides a declared type that's already specific, even
 * one this module doesn't otherwise recognize, since a client-declared type is more trustworthy
 * than a guess whenever it actually says something.
 */
export function inferContentType(fileName: string, declaredContentType: string): string {
  if (!LOW_CONFIDENCE_CONTENT_TYPES.has(declaredContentType)) return declaredContentType;

  const extension = extensionOf(fileName);
  const inferred = extension ? EXTENSION_CONTENT_TYPE[extension] : undefined;
  return inferred ?? declaredContentType;
}
