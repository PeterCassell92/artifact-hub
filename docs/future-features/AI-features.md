# AI Features (future)

*Status: idea / not scheduled. Related: [`../architecture/05-mcp-server-design.md`](../architecture/05-mcp-server-design.md)
(MCP surface), [`../architecture/01-overview.md`](../architecture/01-overview.md) (decision log),
[`../models/access-event.md`](../models/access-event.md) (access data), [`../architecture/03-authorization-and-access-control.md`](../architecture/03-authorization-and-access-control.md)
(authz).*

Speculative AI capabilities we may add post-v1. Nothing here is committed; this file captures the
idea and the constraints it would have to respect.

> **⚠️ Departs from a current core principle.** Today **the backend makes no LLM calls** — all logic
> is deterministic and any summarisation is an MCP **Prompt** run by the *client's* model (see
> [`01`](../architecture/01-overview.md) core principles and [`05`](../architecture/05-mcp-server-design.md)).
> The features below would introduce **server-side LLM calls**, so adopting them is an explicit
> reversal of that decision and must be logged in the `01` decision log if pursued.

---

## Server-side inference over the artifact corpus

Let the MCP server run its own LLM calls to generate insights over the collection of artifacts,
rather than only serving individual artifacts on request. Two signals make good candidates for
inference targets:

- **Most-frequently-accessed artifacts** — derived from `AccessEvent` history (view/download via
  UI, share link, or MCP agent). Surface what's hot: trending artifacts, digests of the most-viewed
  items over a window, or "you haven't looked at this popular artifact yet" nudges.
- **Most-connected artifacts** — artifacts with the most **relationships** to other artifacts (e.g.
  shared audience/groups, same publisher, referenced-by/derived-from links, content similarity).
  Infer clusters, suggest related reading, or auto-summarise a hub artifact and its neighbourhood.

### Possible outputs

- **Auto-generated summaries / abstracts** for high-value artifacts, cached and refreshed on a
  schedule rather than per-request.
- **Relationship / cluster inference** — build and label a graph of related artifacts; expose it as
  a new MCP tool (e.g. `list_related_artifacts`) or resource.
- **Corpus digests** — periodic "what's notable" reports for a group or the whole tenant, gated by
  the requester's access.
- **Trend detection** — flag artifacts gaining access velocity.

### Constraints any implementation must respect

- **Access control still governs everything.** Inference must never leak content or metadata across
  authorization boundaries — an inferred summary/relationship is only visible to a user who could
  already `canView` the underlying artifact(s). Re-evaluate policy at request time, as everywhere
  else; do not bake stale audiences into cached inferences.
- **Audit it.** Server-side reads of artifact content for inference should be auditable (extend or
  reuse `AccessEvent`), so "the model read this" is as traceable as a human view.
- **Deterministic core stays deterministic.** Authorization, policy, and invites remain pure/
  deterministic; LLM output is advisory presentation only — never an input to an access decision.
- **Cost & rate.** Batch/schedule inference (e.g. nightly over the top-N by access or connectivity)
  rather than calling per request; cache results with an invalidation story tied to new
  `AccessEvent`s / policy changes.
- **Provider.** If pursued, default to the latest Claude models (see `claude-api` skill) and keep
  the LLM boundary behind an interface so it can be stubbed in tests.

### Open questions

- How are artifact **relationships** modelled and stored? (No relationship model exists today — this
  likely needs a new domain concept in [`../models/`](../models/).)
- Where do server-side LLM calls run — inline in the backend, or a separate worker/job?
- What's the refresh cadence and the cache-invalidation trigger?
- Which surface exposes results: new MCP tools/resources, API endpoints for the SPA, or both?
