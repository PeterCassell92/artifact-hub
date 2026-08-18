# 05 — MCP Server Design

*Status: design. Spec baseline: MCP **2026-07-28**. Related:
[02](02-auth-identity-and-admin.md), [03](03-authorization-and-access-control.md),
[06](06-api-design.md). Tool-description standard: `.claude/skills/mcp-tool-descriptions`.*

The MCP server is the second adapter over the same `core` domain layer as the REST API. It
lets Claude Desktop (and other MCP clients) publish, discover, fetch, comment on, and share
artifacts conversationally.

---

## 1. Transport & endpoint

- Single endpoint **`/mcp`** over **Streamable HTTP** (not SSE — deprecated for new servers).
- Stateless-friendly, so it scales behind `fly-proxy` across many Fly machines.
- Built with the **MCP TypeScript SDK** (`StreamableHTTPServerTransport`) mounted on the same
  Express app that serves `/api/*`.
- **Server-level `instructions`** (spec's `InitializeResult.instructions`, sent once during the
  `initialize` handshake): whole-server orientation for the agent — how publishing/discovery/
  sharing/revocation fit together and that a companion web app exists — complementing (not
  replacing) each tool/prompt/resource's own description. See `instructions.ts`.

## 2. Authentication & authorization

Full flow and rules: [`02` §1.1](02-auth-identity-and-admin.md). In brief:

- The server is an OAuth **Resource Server**: it advertises Protected Resource Metadata and relies
  on Auth0 + Dynamic Client Registration so clients self-register; login uses the **passwordless
  magic link** in the OAuth browser step.
- Every request carries a bearer token validated for signature/issuer/expiry **and audience** — a
  token is accepted only if `aud` = the **MCP resource** (**R2**, reject otherwise). The token
  resolves to a local `users` row; **if none, or `status != active`, the request is denied — the
  MCP path never provisions users** (**R1/R4**, admin-controlled user set).
- **Identity-only tokens (R3).** The agent may do **everything the human member can do** (publish,
  view per policy, comment, share, manage its own artifacts' policy) — but **no admin /
  user-management** action. There are **no admin MCP tools**, and admin routes live only under
  `/api/admin/*` (API audience + `role=admin`), which an MCP token cannot reach.
- Every tool/resource call runs the **same `canView` / `canComment` / `canManagePolicy`**
  functions from `03`. The agent's identity (from its token) is the authorization subject —
  **never** a link or presigned URL.

### Out of scope for the MCP surface (never exposed as tools)
User management (invite/promote/demote/disable), group management, and any other admin action.
These are human-UI functions on `/admin` only (see `02` §7, `../frontend/`).

---

## 3. Design principles for file delivery

**The agent never handles a link or presigned URL.** Authorization comes from the token;
content comes back through MCP itself.

- **Tools** are for *reasoning over metadata and small content*. Tool results stay
  **metadata-only (~a few KB)** — never raw file bytes.
- **Resources** are for *files and large content*: each artifact is a stable resource URI
  `artifact://<id>` (blob + mimeType). The client reads it on demand; the server authorizes via
  token and pulls bytes from Tigris **server-side via GetObject with the held scoped key (AWS SDK
  against Tigris)**.
- **Download to disk is host-mediated**: the human clicks *save* in Claude Desktop; the host
  writes the file. No silent agent-to-disk.
- **Presigned URLs stay OUT of the MCP path** (browser/download only). The resource URI
  re-authorizes and re-fetches fresh on each read, so revocation applies to agents too.

> ⚠️ **Test on Claude Desktop directly:** cross-client divergence + reported base64 /
> embedded-resource quirks. Verify magic bytes (e.g. `%PDF`, PNG signature) and correct
> `mimeType` end-to-end.

---

## 4. Tools (v1)

Each tool description in code must follow the `mcp-tool-descriptions` skill (what it does /
when to use / when NOT to use / disambiguation / example). Summary of the surface:

| Tool | Purpose | Input (zod) | Result (metadata-only) |
|------|---------|-------------|------------------------|
| `publish_artifact` | Publish a new artifact + set its access policy | `{ title, description?, fileName, contentType, bytesRef, tags?, metadata?, audience:{type, userEmails?/groupNames?}, expiry: '24h'|'7d'|'30d'|'never', relationships?: [{toId, type, note?}] }` | start: `{ artifactId, resourceUri, uploadUrl, webUploadUrl, bytesRef, relationshipResults? }`; finish: `{ artifactId, resourceUri }` |
| `list_artifacts` | List the caller's own artifacts ("My Artifacts") | `{ cursor?, limit? }` | table: id, title, filetype, createdAt, policy summary |
| `list_shared_with_me` | List artifacts shared **to** the caller, optional time window | `{ sinceHours?, cursor?, limit? }` | **all** results returned; **first 10 rendered** as a markdown table (numeric id, filetype, publishingUserName, publicationDate) |
| `get_artifact` | Fetch **small** content inline for reasoning | `{ id }` | small image → image block; small text/PDF → embedded resource; else → pointer to `artifact://<id>` |
| `comment_on_artifact` | Add an attributable comment | `{ id, body }` | `{ commentId, createdAt }` |
| `list_comments` | Read back an artifact's comments, oldest first | `{ id }` | `{ comments: [{ id, authorName, body, createdAt }] }` + markdown table |
| `get_access_history` | Read back who viewed/downloaded an artifact and when, including denied attempts (revoked/expired/not_in_audience/disabled) — newest first. **Owner-only**, unlike `list_comments`/`list_artifact_relationships` (no admin path over MCP — `02` §7) | `{ id, cursor?, limit? }` | `{ accessEvents: [{ id, userId, userName, userEmail, action, route, decision, denyReason?, at }], nextCursor }` + markdown table |
| `link_artifacts` | Link an owned artifact to one you can view (`supersedes`/`derived_from`/`related_to`), post-hoc | `{ fromId, toId, type, note? }` | `{ relationshipId, createdAt }` |
| `list_artifact_relationships` | Read back an artifact's relationships, either direction | `{ id }` | `{ relationships: [{ id, type, direction, note, otherArtifact, createdByName, createdAt }] }` + markdown table |
| `list_relationships` | Read relationships **across the whole corpus**, optionally filtered to one `type` — for inference over the graph, not one artifact's own connections | `{ type?, cursor?, limit? }` | `{ relationships: [{ id, type, note, from, to, createdByName, createdAt }], nextCursor }` + markdown table |
| `unlink_artifacts` | Retract a relationship (owner of its `fromId` only); no in-place edit — unlink then re-`link_artifacts` | `{ relationshipId }` | `{ ok }` |
| `create_share_link` | Mint a locator link for an artifact you can view (owner or not) | `{ id }` | `{ url }` |
| `set_access_policy` | Change an owned artifact's audience/expiry — narrowing is the general revocation mechanism | `{ id, audience, expiry }` | `{ ok, effectiveFrom }` |
| `revoke_access` | Instant, whole-artifact cutoff for an owned artifact — independent of audience/expiry (`03` §1a) | `{ id }` | `{ ok, revokedAt }` |
| `get_user_details` | Caller's own identity — email, name, role, group names | `{}` | `{ email, name, role, groupNames }` |
| `list_groups` | Every group in the org, regardless of the caller's membership | `{}` | `{ groups: [{ name, description }] }` + markdown table |

Notes:
- **`get_user_details` and `list_groups` exist so `audience.groupNames` isn't a guessing game.**
  `publish_artifact` and `set_access_policy` need an *exact* group name string, and there's no other
  MCP-reachable way to discover one — `GET /api/me` and `GET /api/admin/groups` are API-audience-only
  and unreachable from an MCP token (R2). Both tool descriptions point agents at `get_user_details`
  (the caller's own groups) or `list_groups` (every group — **publishing/sharing to a group the
  caller doesn't belong to is a supported journey**, not an error) rather than guessing. Neither
  tool exposes group *membership rosters* or any create/rename/membership-change capability —
  read-only names/descriptions only, staying clear of the "no group management over MCP" rule below.
- **Publishing is also available via the SPA** (see `06` and `../frontend/`) — a three-step
  "Publish New Artifact" modal on the Dashboard (file, metadata, access policy) that sets
  kind/tags/language/relationships and requires the owner to set a real audience before it saves.
  `publish_artifact` remains the only way to set a free-text `sourceTool` (the SPA always sends
  `"frontendSPA"` itself) or any language code (the SPA restricts language to a fixed dropdown).
- **Capture rich metadata at publish.** `publish_artifact` should collect the classification
  metadata that powers the frontend filters — `kind`, `tags`, `sourceTool` (e.g. "Claude
  Desktop"), plus free-form `metadata` — per [`../models/artifact.md`](../models/artifact.md).
  The backend derives `fileExtension`, `sizeBytes`, `checksumSha256`.
- **Upload path** for `publish_artifact`: hand the client a **presigned PUT** so bytes go
  straight to Tigris out-of-band (`bytesRef` correlates the upload), *or* accept small content
  inline for tiny artifacts. Large bytes never transit a tool argument/result.
  - **Two completion paths, the agent self-selects** (decision #47): a host with its own HTTP
    capability (e.g. Claude Code's Bash/curl) PUTs to `uploadUrl` and finishes with the
    `bytesRef` call, exactly as decision #44 designed. A host with no HTTP tool (e.g. Claude
    Desktop — the model cannot perform a PUT at all) instead hands the user `webUploadUrl`, an
    id-only SPA link (`/artifacts/{id}/complete-upload`, no token — session auth + ownership
    gate it) where the user picks the file and the page uploads + finalizes itself; no second
    tool call needed. The page re-mints its presigned URL via `POST /api/artifacts/:id/upload-url`
    (`06` §2) since the original expires in ~5 minutes. Until either path completes, the
    artifact is an **owner-only draft**: `canView` denies its audience (`pending`), it's absent
    from `list_shared_with_me`, and publish notifications only go out at finalize. The finish
    call is idempotent — replaying `bytesRef` after the browser page already finished is a
    clean success, not an error.
- **500MB size cap.** The presigned PUT has no size condition, so the finish call is the earliest
  point the backend actually knows how big the upload was: it `HeadObject`s the file, and if it's
  over `MAX_ARTIFACT_SIZE_BYTES` (`packages/contracts`), deletes the object and returns an error
  instead of recording it — a low-effort guardrail against storage costs ballooning (demo has
  trusted publishers only, not a security control). Same cap applies to the SPA's upload (`06`),
  which also pre-checks client-side before it starts uploading.
  - **Known limitation: this is a post-hoc check, not a pre-upload block.** By the time
    `finalizeArtifact` runs, the full file has already landed in Tigris — the client-side
    check (SPA) or an honest MCP agent is the only thing stopping an oversized upload before
    the bytes actually transfer; a caller that ignores `fileName`/size and PUTs anyway will
    still push the full file to Tigris before the reject-and-delete kicks in. Acceptable for a
    trusted-users demo (brief storage exposure, not a real cost or abuse vector), but not a true
    limit enforced at the storage layer.
  - **Better alternative (not implemented):** switch the presigned upload from
    `PutObjectCommand`+`getSignedUrl` (`storage/s3.ts`) to S3's `createPresignedPost` with a
    `content-length-range` condition — Tigris/S3 would then reject an oversized upload
    mid-transfer, before it's fully landed, no reactive delete needed. Bigger change: it moves
    the upload from a raw `fetch(url, {method:"PUT", body: file})` to a multipart form POST, so
    it touches `storage/s3.ts`, the SPA's upload call, and the MCP `publish_artifact` docs/agent
    contract (the presigned URL response shape changes from a bare URL to
    `{url, fields}`).

- `list_shared_with_me` directly satisfies *"Which artifacts have been shared with me in the
  last 24 hours?"* — pass `sinceHours: 24`. It returns the full set (for the agent to reason
  over) but renders only the first 10 rows as the required markdown table.
- **Relationships enrich at the moment of most context.** `publish_artifact`'s optional
  `relationships` links a brand-new artifact to existing ones in the same call (`type` one of
  `supersedes`/`derived_from`/`related_to`, plus an optional `note`); a bad `toId` is reported
  per-entry in `relationshipResults`, it never fails the publish itself. `link_artifacts` is the
  post-hoc equivalent for when the connection only becomes clear later. Both are owner-only for
  `fromId`; `toId` only needs to be `canView`-able by the linker, not owned by them —
  linking your artifact to someone else's (that you can see) is a supported journey.
  `list_artifact_relationships` reads them back, redacting `otherArtifact` to `null` per-row when
  the caller can't view that side, so a relationship on a visible artifact never leaks a private
  one on its far end. `unlink_artifacts` retracts one by id — owner of its `fromId` only, same as
  creating it; there's no in-place edit, so changing a relationship is unlink then re-link. The
  REST equivalents (`06` §2) back the artifact detail page's own add/remove UI.
- **`list_relationships` is the bulk, corpus-wide counterpart** — no anchor artifact, so a row is
  returned whenever the caller can view `from` **or** `to` (excluded outright if neither side is
  visible), with each side independently redacted to `null` per the same rule above. Optional
  `type` scopes to one relation type; omitting it returns every type in one cursor-paginated call
  — meant for an agent reasoning over the relationship graph as a whole (e.g. "which artifacts
  have been superseded"), where per-artifact calls would mean one round-trip per artifact. `GET
  /api/relationships` (`06` §2) is its REST equivalent.

### `list_shared_with_me` result shape (illustrative)

```
| # | Type | Published by | Published |
|---|------|--------------|-----------|
| 1 | mermaid (.mmd) | Alice Dev | 2026-08-09 |
| 2 | pdf            | Bob Prod  | 2026-08-08 |
...(first 10 shown; N total returned)
```

---

## 5. Resources

- **`artifact://<id>`** — the artifact body. On `resources/read`: validate token → `canView` →
  server-side `GetObject` via the held scoped key (AWS SDK against Tigris) → return `{ blob(base64), mimeType }`. This is the
  **only** way an agent obtains file bytes. Each read **records an AccessEvent** (`route=mcp`,
  `action=download`, `decision=allowed|denied`) — the agent access route in the audit trail
  (see [`../models/access-event.md`](../models/access-event.md)).
- Optionally a **collection resource** listing artifacts the caller may read (browsable). v1 can
  rely on the `list_*` tools instead; the collection resource is a nice-to-have.

Because reads re-authorize every time, an owner narrowing a policy (revocation) also stops the
agent path — consistent with `03` §4.

---

## 6. Prompts — `summarise_artifact_reviews`

The "summarise reviews of an artifact" capability is an **MCP Prompt** (a user-controlled
template surfaced in Claude Desktop, e.g. as a slash command), **not** a server-side LLM call.

- **`summarise_artifact_reviews(artifactId)`**:
  1. Server validates token → `canView(user, artifact)`.
  2. Server fetches the artifact's comments (body, author name, date).
  3. Server returns prompt **messages** with the comments injected (as text and/or an embedded
     resource), plus an instruction like *"Summarise the key themes, sentiment, and action
     items from these reviews."*
  4. **Claude Desktop's own model** produces the summary.

The backend stays **LLM-free** — no model keys, no cost, no prompt-injection surface on our
side. This is stable per the 2026-07-28 spec (`prompts/list`, `prompts/get`). The experimental
**Skills-over-MCP** proposal (`skills/list`/`skills/activate`) is noted as a future option but
deliberately not used in v1.

---

## 7. Mapping requirements → MCP surface

| Requirement scenario | MCP element |
|----------------------|-------------|
| Publish a Mermaid diagram with groups + 7-day expiry | `publish_artifact` (audience=user_groups, expiry='7d') |
| "Which artifacts shared with me in last 24h?" as a table | `list_shared_with_me(sinceHours:24)` |
| Download a selected artifact without bloating context | read Resource `artifact://<id>`; host-mediated save |
| Never return the file as a tool result | Resources only; tools stay metadata-only |
| Comment via agent | `comment_on_artifact` |
| Read back an artifact's comments | `list_comments` |
| "Who has viewed/downloaded my artifact, and when?" | `get_access_history` (owner-only) |
| Summarise the reviews | Prompt `summarise_artifact_reviews` |
| Revoke access via agent | `set_access_policy` |

---

## 8. Testing (see `09`)

- **In-memory**: the MCP TS SDK's in-memory client/transport exercises each tool/resource/prompt
  handler directly (fast, granular).
- **HTTP integration**: black-box tests hitting `/mcp` over HTTP with a real token, asserting the
  JSON-RPC envelopes and that files come back as Resources (never tool results).
- **Manual**: **MCP Inspector** for exploratory checks; **Claude Desktop** for the base64/mime
  end-to-end verification flagged in §3.
