# Model — AccessEvent (artifact access audit trail)

We need an **audit trail of when an artifact was accessed**, capturing that access can happen
through **multiple routes** — the web UI, a shared link, or an **agent via MCP** — all of which
must be audited correctly. This is a distinct concern from administrative auditing
(`system.md` → `AdminAuditLog`).

Related: [`artifact.md`](artifact.md),
[`../architecture/03-authorization-and-access-control.md`](../architecture/03-authorization-and-access-control.md),
[`../architecture/10-observability.md`](../architecture/10-observability.md).

---

## 1. Purpose

- Answer "**who accessed this artifact, when, and how?**" for any artifact (owner and admins).
- Distinguish the **access route** so we can tell UI views from link redemptions from agent reads.
- Feed the artifact's derived `lastAccessedAt` and any "recently accessed" views.

## 2. Fields

| Field | Type | Req | Meaning |
|-------|------|:---:|---------|
| `id` | uuid | yes | Event id |
| `artifactId` | uuid → Artifact | yes | What was accessed |
| `userId` | uuid → User | yes | Who accessed it (always authenticated — no anonymous access) |
| `route` | enum | yes | **How**: `ui` \| `share_link` \| `mcp` |
| `action` | enum | yes | `view` \| `download` (a `download` is the byte-delivery step; `view` is opening detail/metadata) |
| `shareLinkId` | uuid → ShareLink | no | Set when `route = share_link` (which link was used) |
| `at` | timestamp | yes | When (UTC) |
| `clientInfo` | json | no | Non-PII context: user-agent / MCP client name+version |
| `decision` | enum | yes | `allowed` \| `denied` — we record denied attempts too (revocation/expiry evidence) |
| `denyReason` | string | no | e.g. `expired`, `not_in_audience` (when `decision = denied`) |

## 3. The three access routes (all audited)

| Route | Triggered by | Recorded at |
|-------|--------------|-------------|
| `ui` | Human opens artifact detail / clicks download in the SPA | API handler for `GET /api/artifacts/:id` and `.../download` |
| `share_link` | Human redeems `/s/<token>` then views/downloads | Share-link redemption handler (`GET /api/s/:token`), with `shareLinkId` |
| `mcp` | Agent reads the `artifact://<id>` Resource (or `get_artifact`) | MCP resource/tool handler |

Every route runs the **same `canView`** check (arch/03) and writes an `AccessEvent` with the
resulting `decision`. Because authorization is re-evaluated per request, a **denied** event after
revocation/expiry is exactly what the audit trail should show.

## 4. What we deliberately record

- **Both allowed and denied** accesses (denied ones prove revocation/expiry worked).
- **Downloads separately from views**, so an owner can see actual byte retrievals vs. metadata opens.
- **The route**, so UI/link/agent access are distinguishable in reports.

## 5. What we avoid

- No raw file bytes, tokens, or presigned URLs in the event.
- `clientInfo` stays non-PII (client name/version, coarse UA) — see privacy note in
  `../architecture/10-observability.md`.

## 6. Indexing intent

- `(artifactId, at desc)` — per-artifact access history (owner/admin view).
- `(userId, at desc)` — "what did this user access" (admin/audit).
- `(route)` / `(decision)` — reporting facets.
