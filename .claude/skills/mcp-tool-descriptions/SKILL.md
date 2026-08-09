---
name: mcp-tool-descriptions
description: The standard for writing MCP tool, resource, and prompt descriptions for Artifact Hub so agents reliably pick the right one. Use whenever adding or editing a tool/resource/prompt in the MCP server (apps/backend/src/adapters/mcp), or reviewing an MCP description. Ensures each description states what it does, when to use it, when NOT to use it, how it differs from siblings, argument semantics, and an example.
---

# Writing MCP tool descriptions (Artifact Hub)

An MCP tool description is the *only* thing the agent reads to decide whether to call the tool.
Treat it as agent-facing UX, not developer docs. Applies to the surface in
[docs/architecture/05-mcp-server-design.md](../../../docs/architecture/05-mcp-server-design.md).

## The template

Every tool description must cover, in order:

1. **What it does** — one crisp sentence, action-first ("Publishes a new artifact and sets its
   access policy.").
2. **When to use it** — the trigger conditions in the user's terms.
3. **When NOT to use it** — the anti-triggers, especially the sibling that *should* be used
   instead.
4. **Disambiguation** — explicitly name the neighbouring tool(s) and the dividing line.
5. **Arguments** — what each means, allowed values, and units (e.g. expiry is one of
   `24h`/`7d`/`30d`/`never`). Enforce with zod; keep names self-explaining.
6. **Result shape** — what comes back (and, for Artifact Hub, that results are **metadata-only**;
   file bytes come via the `artifact://<id>` Resource, never a tool result).
7. **Example** — one realistic call.

## Artifact Hub specifics to always encode

- **Files are Resources, not tool results.** Any tool touching an artifact must say bytes are
  delivered via the `artifact://<id>` Resource and are never returned inline.
- **Authorization is by the caller's token.** Never mention links/presigned URLs as inputs.
- **Owner-only tools** (`set_access_policy`, `create_share_link`) must state they act only on
  artifacts the caller owns.
- **Disambiguation that matters here**:
  - `list_artifacts` (my own / "My Artifacts") vs `list_shared_with_me` (shared *to* me).
  - `get_artifact` (small content, inline for reasoning) vs reading the `artifact://<id>`
    Resource (full file, for download/large content).

## Good vs bad

**Bad** (agent can't tell it apart from siblings):
> `list_shared_with_me`: Lists artifacts.

**Good**:
> `list_shared_with_me`: Lists artifacts that other users have shared **with the calling user**,
> optionally within a recent time window (`sinceHours`). Use when the user asks "what's been
> shared with me" or "shared in the last 24 hours". Do NOT use for the user's own uploads — use
> `list_artifacts` for those. Returns metadata rows (id, filetype, publishedBy, publishedAt);
> the first 10 are rendered as a markdown table. Example: `list_shared_with_me({ sinceHours: 24 })`.

## Prompts and resources

- **Prompt** descriptions (e.g. `summarise_artifact_reviews`) state that the user invokes them
  (surfaced as a slash command) and what the client's model will do — our backend performs no
  LLM call.
- **Resource** descriptions state the URI scheme (`artifact://<id>`), that reads are
  re-authorized every time, and that they return blob + mimeType.

## Checklist before merging a new MCP element

- [ ] What / when / when-not / disambiguation all present
- [ ] Names a sibling tool and the dividing line
- [ ] Argument enums + units spelled out; validated with zod
- [ ] States metadata-only result (bytes via Resource)
- [ ] Owner-only noted where applicable
- [ ] Includes one example call
