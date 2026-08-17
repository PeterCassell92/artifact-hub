# Frontend Design

What a user experiences on the web app: how they sign in, land, and manage/view/discover their
artifacts. Companion to the API (`../architecture/06-api-design.md`), the models
(`../models/`), and auth (`../architecture/02-auth-identity-and-admin.md`).

## Publishing

**Publishing is available both from an agent and from the SPA.** A user can ask their agent (e.g.
Claude Desktop) to publish via the MCP `publish_artifact` tool, or click **"Publish New
Artifact"** on the Dashboard — a two-step modal: pick a file, then set its access policy (audience
+ expiry, same fields as the artifact detail page's policy editor — the "Specific people" audience
is a combo box of real users, never free text). Title is always the file's name; there's no
title-edit surface (artifact editing is out of scope for v1, `../architecture/01-overview.md` §8).
Either path lands the artifact in **My Artifacts**.

## Stack & patterns

React + **Redux Toolkit** (state) + **Tailwind** (styling), modular well-tested components,
professional/restrained visuals. Development conventions — including the **banned anti-patterns**
(no `window.alert`/`confirm`/`prompt`, no toasts; use in-DOM state-driven notifications and modals) —
live in [`../development/frontend-patterns.md`](../development/frontend-patterns.md) and the
`frontend-patterns` / `frontend-component-testing` Claude skills.

## Contents

| Doc | Covers |
|-----|--------|
| [`01-frontend-overview.md`](01-frontend-overview.md) | Sign-in (magic link), dashboard, My Artifacts, Shared With Me, artifact detail, admin area, route map |
| [`02-filtering-and-search.md`](02-filtering-and-search.md) | Filters, search, sort — the discovery UX and the metadata it relies on |

## Actors

- **Member** — sign in, browse **My Artifacts** and **Shared With Me**, open artifact detail
  (view/download, read/add comments), create/revoke share links, change their own artifacts'
  access policy. **Can publish a file directly from the Dashboard, or via their agent.**
- **Admin** — everything a member can do, plus the **admin area** (`/admin`): invite users,
  promote/demote admins, manage groups. See `../architecture/02-auth-identity-and-admin.md`.
