/** Small display helpers for MCP list-tool markdown tables (docs/architecture/05 §4). */

interface TypedRow {
  kind: string;
  fileName: string;
}

function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx) : "";
}

function typeLabel(row: TypedRow): string {
  const ext = fileExtension(row.fileName);
  return ext ? `${row.kind} (${ext})` : row.kind;
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
  revoked: boolean;
}

const AUDIENCE_LABELS: Record<string, string> = {
  public_authenticated: "public",
  specific_users: "specific users",
  user_groups: "groups",
};

function policySummary(row: OwnedRow): string {
  const audience = AUDIENCE_LABELS[row.audienceType] ?? row.audienceType;
  const expiry = !row.expiresAt
    ? "never expires"
    : `${row.isExpired ? "expired" : "expires"} ${row.expiresAt.slice(0, 10)}`;
  // Independent of expiry (03 §1a) — an artifact can be revoked well before its bucketed window
  // would otherwise have elapsed, so this is called out separately, not folded into "expired".
  return row.revoked ? `REVOKED, ${audience}, ${expiry}` : `${audience}, ${expiry}`;
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

interface CommentRow {
  authorName: string;
  body: string;
  createdAt: string;
}

/** `list_comments` table — oldest first, matching `listComments()`'s ordering. */
export function commentsTable(items: CommentRow[]): string {
  const rows = items.map(
    (c) => `| ${c.createdAt.slice(0, 10)} | ${c.authorName} | ${c.body.replace(/\|/g, "\\|")} |`,
  );
  return ["| date | author | comment |", "|---|---|---|", ...rows].join("\n");
}

interface RelationshipRow {
  type: string;
  direction: "outgoing" | "incoming";
  otherArtifact: { id: string; title: string } | null;
  note: string | null;
  createdAt: string;
}

/** `list_artifact_relationships` table — newest first, matching `listRelationships()`'s ordering.
 * A row whose `otherArtifact` is null means the caller can't view the far side of that
 * relationship — shown as "(restricted)" rather than dropped, since the link itself still exists. */
export function relationshipsTable(items: RelationshipRow[]): string {
  const rows = items.map((r) => {
    const arrow = r.direction === "outgoing" ? "→" : "←";
    const other = r.otherArtifact ? `${r.otherArtifact.title} (${r.otherArtifact.id})` : "(restricted)";
    return `| ${r.type} | ${arrow} | ${other} | ${r.note ?? ""} | ${r.createdAt.slice(0, 10)} |`;
  });
  return ["| type | direction | other artifact | note | createdAt |", "|---|---|---|---|---|", ...rows].join("\n");
}

interface RelationshipByTypeRow {
  type: string;
  from: { id: string; title: string } | null;
  to: { id: string; title: string } | null;
  note: string | null;
  createdAt: string;
}

/** `list_relationships` table — newest first, matching `listRelationshipsByType()`'s ordering.
 * Unlike `relationshipsTable` there's no anchor artifact, so both `from` and `to` are shown
 * explicitly; either can independently be "(restricted)" when the caller can't view that side. */
export function relationshipsByTypeTable(items: RelationshipByTypeRow[]): string {
  const side = (a: { id: string; title: string } | null) => (a ? `${a.title} (${a.id})` : "(restricted)");
  const rows = items.map(
    (r) => `| ${r.type} | ${side(r.from)} | ${side(r.to)} | ${r.note ?? ""} | ${r.createdAt.slice(0, 10)} |`,
  );
  return ["| type | from | to | note | createdAt |", "|---|---|---|---|---|", ...rows].join("\n");
}
