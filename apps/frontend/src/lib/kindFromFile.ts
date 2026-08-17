import type { ArtifactKind } from "contracts";

/** Extension (lowercased, no dot) -> kind. Checked before contentType since it's more specific
 * (e.g. distinguishes a `.mmd` Mermaid diagram from other `text/plain` files). */
const EXTENSION_KIND: Record<string, ArtifactKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  tiff: "image",
  ico: "image",
  kra: "image",
  pdf: "document",
  doc: "document",
  docx: "document",
  txt: "document",
  rtf: "document",
  odt: "document",
  md: "document",
  html: "document",
  htm: "document",
  mmd: "diagram",
  mermaid: "diagram",
  json: "data",
  csv: "data",
  tsv: "data",
  xlsx: "data",
  xls: "data",
  xml: "data",
  yaml: "data",
  yml: "data",
};

/** contentType prefix -> kind, used when the extension isn't recognized (e.g. a file with no
 * extension, or one not in EXTENSION_KIND). */
const CONTENT_TYPE_PREFIX_KIND: Array<[string, ArtifactKind]> = [
  ["image/", "image"],
  ["application/pdf", "document"],
  ["text/x-mermaid", "diagram"],
  ["application/json", "data"],
  ["text/csv", "data"],
];

/**
 * Best-guess `kind` from a file's name/contentType, used only to pre-fill the publish modal's
 * Kind select with a sensible starting value — the field stays fully editable, this never
 * overrides a value the publisher already chose (see PublishArtifactModal's `kindTouched`).
 */
export function inferKindFromFile(fileName: string, contentType: string): ArtifactKind {
  const extension = /\.([a-zA-Z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase();
  if (extension && extension in EXTENSION_KIND) return EXTENSION_KIND[extension]!;

  const match = CONTENT_TYPE_PREFIX_KIND.find(([prefix]) => contentType.startsWith(prefix));
  return match ? match[1] : "other";
}
