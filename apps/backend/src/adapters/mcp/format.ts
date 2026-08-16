/** Small display helpers for MCP list-tool markdown tables (docs/architecture/05 §4). */

interface TypedRow {
  format: string | null;
  kind: string;
  fileName: string;
}

function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx) : "";
}

function typeLabel(row: TypedRow): string {
  const ext = fileExtension(row.fileName);
  const base = row.format ?? row.kind;
  return ext ? `${base} (${ext})` : base;
}

interface SharedRow extends TypedRow {
  publisherName: string | null;
  publishedAt: string;
}

/** First-10 markdown table shape from docs/architecture/05 §4 ("# | Type | Published by | Published"). */
export function sharedWithMeTable(items: SharedRow[]): string {
  const rows = items
    .slice(0, 10)
    .map((a, i) => `| ${i + 1} | ${typeLabel(a)} | ${a.publisherName ?? "Unknown"} | ${a.publishedAt.slice(0, 10)} |`);
  return ["| # | Type | Published by | Published |", "|---|------|--------------|-----------|", ...rows].join("\n");
}

interface OwnedRow extends TypedRow {
  id: string;
  title: string;
  publishedAt: string;
  audienceType: string;
  expiresAt: string | null;
  isExpired: boolean;
}

const AUDIENCE_LABELS: Record<string, string> = {
  public_authenticated: "public",
  specific_users: "specific users",
  user_groups: "groups",
};

function policySummary(row: OwnedRow): string {
  const audience = AUDIENCE_LABELS[row.audienceType] ?? row.audienceType;
  if (!row.expiresAt) return `${audience}, never expires`;
  const date = row.expiresAt.slice(0, 10);
  return `${audience}, ${row.isExpired ? `expired ${date}` : `expires ${date}`}`;
}

/** "My Artifacts" table shape from docs/architecture/05 §4 ("id, title, filetype, createdAt, policy summary"). */
export function ownedArtifactsTable(items: OwnedRow[]): string {
  const rows = items.map(
    (a) => `| ${a.id} | ${a.title} | ${typeLabel(a)} | ${a.publishedAt.slice(0, 10)} | ${policySummary(a)} |`,
  );
  return ["| id | title | filetype | createdAt | policy |", "|---|---|---|---|---|", ...rows].join("\n");
}

interface GroupRow {
  name: string;
  description: string | null;
}

/** `list_groups` table — every group in the org, for referencing in audience.groupNames. */
export function groupsTable(items: GroupRow[]): string {
  const rows = items.map((g) => `| ${g.name} | ${g.description ?? ""} |`);
  return ["| name | description |", "|---|---|", ...rows].join("\n");
}
