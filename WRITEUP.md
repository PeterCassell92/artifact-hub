# Deliverables

## 1. Running system at a publicly accessible URL

Yes - the system runs at [https://artifact-hub.netlify.app/](https://artifact-hub.netlify.app/)

The system however is **by invite only**. This is a product decision to ensure that only authenticated & authorized users can access artifacts.

I will send out initial email invites alongside this repo.

## 2. MCP Server configuration

Once authenticated in the SPA for the first time, users can get started with the MCP. The guide is here:

[https://artifact-hub.netlify.app/get-started](https://artifact-hub.netlify.app/get-started)

This MCP server is consumable via Claude Code, Claude Desktop and other providers and will require authentication via Auth0.

## 3. WRITEUP.md (this file)

- What you built and why (product decisions)
- What you chose not to build and why
- Architecture overview
- How the MCP integration works
- Where and why you used LLM capabilities
- Deployment approach
- What you'd do next with another week

This content is in the section below.

## 4. Video Walkthrough

TODO: produce Loom video

## 5. Claude Code session logs

Redacted session logs are shared via Artifact Hub itself (published and access-controlled through
the platform) rather than committed to this repo - it's a more fitting distribution channel for
this kind of artifact than git, and avoids ever having raw session transcripts (which can capture
things like shell environment output) sitting in source control.

The `w_claude-project-data-copies` folder here still holds the copied `.claude` project files
(skills, `.mcp.json`) referenced elsewhere in this writeup, minus the session logs themselves.

---

# WRITEUP Content

## What I Built and Why?

I built Artifact Hub, a dual-purpose application that enables users who generate artifacts with generative AI - such as Claude Code and Claude Desktop - to publish those artifacts easily, and manage access to those artifacts intuitively.

- Artifacts can be shared with other authenticated users, either generally across the organisation, specifically with the members of a team, or with specifically named individuals.
- MCP connection is easy, and agents can produce artifact insights from the metadata stored against the artifacts, including their relationship to other artifacts. Across large datasets, inferences here could be quite useful.

I built with ease-of-use and security in mind. I wanted to demonstrate a fully-operating production system, so chose to use Auth0 as an IdP. This is because I knew that Auth0 could provide authentication for the MCP server with dynamic clients (agents consuming the MCP) and keep the SPA / API routes authenticated with a different token claim, allowing me to have fine control over what is possible within the MCP vs within the SPA.

As I built an authentication system, I also created an admin role to manage users, so that regular member users have fixed permissions that determine which artifacts are shared with them.

Share links are minted, but authorization is always checked prior to showing the artifact, meaning that access can be revoked easily when needed.

## What I Chose Not to Build and Why

I chose to ultimately focus my time on getting the authentication, access control, email notifications and MCP operating well, however there are many features that would be possible to add given extra time.

- I chose to keep the artifact actions simple and not support deletion of artifacts from Tigris (S3-compatible store). This decision was to keep full auditability, and to make it easy for users to reverse their decision and make an artifact visible again.
- I chose not to add custom timeframes for expiry, purely to keep the publishing process simple. This would be a future improvement.

## Architecture Overview

- **SPA** hosted on Netlify (React TS app with Vite).
- **Backend**: Node Express, hosted on Fly.io (Express TS app with MCP HTTP streamable support). A single backend serves both `/api` and `/mcp` over one shared "core" domain layer, so authz, publishing and relationship logic are written once and used by both the human and agent paths.
- **Data & storage**: Fly Managed Postgres for the database (via Prisma), and Tigris (S3-compatible object storage) for the artifact files themselves. Presigned URLs to Tigris are only ever handed to the browser/download path - agents never receive file bytes back from an MCP tool call, they fetch the `artifact://` resource instead.
- **IdP**: Auth0 - one tenant per environment, issuing separate token claims for the SPA/API session vs MCP agent access, which is what lets me scope agents more tightly than logged-in humans.
- **Email**: Resend, used for magic-link sign-in and invitations (there are no passwords anywhere in the system).
- **Shared contract**: `packages/contracts` is a shared zod schema package imported by both the frontend and backend, so the API/MCP contract is type-checked in one place rather than duplicated.
- **AI enrichment**: AWS Bedrock (Claude Sonnet), called from a background worker only - a deliberate, scoped exception to an otherwise LLM-free backend (see "Where and why I used LLM capabilities" below). Rides the same transactional-outbox worker already used for email, so it needed no new job infrastructure.


## How the MCP Integration Works

The MCP server isn't a separate service - it's mounted on the same Express app as the REST API, at a single `/mcp` endpoint over Streamable HTTP. It's a second "adapter" over the same `core` domain layer as `/api/*`, so publishing, authorization and relationship logic is written once and reused by both humans (SPA) and agents (MCP).

### Discoverability via Protected Resource Metadata (PRM)

An agent shouldn't need a human to hand-configure a client ID and secret before it can talk to the server. I leant on the standard OAuth discovery flow so a client like Claude Desktop can find and authenticate itself automatically:

- An unauthenticated request to `/mcp` gets a `401` with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource` (RFC 9728) - our **Protected Resource Metadata**.
- The PRM tells the client which Authorization Server issues valid tokens (Auth0) and which resource identifier (audience) to request a token for.
- The client then reads Auth0's own `/.well-known/openid-configuration` to find the `authorize`, `token` and `registration` endpoints, and **self-registers** via Dynamic Client Registration (RFC 7591) - no manual app setup on my side per client.
- It then runs Authorization Code + PKCE against Auth0, opening the system browser to the same passwordless magic-link login humans use, with an RFC 8707 `resource` indicator naming the MCP resource so the token comes back scoped (`aud`) to `/mcp` specifically, not the API.

The upshot: pointing a fresh Claude Desktop/Claude Code install at our `/mcp` URL is enough for it to discover how to authenticate, register itself, and get a correctly-scoped token - no bespoke onboarding step per agent.

### Tools, Resources and Prompts - three primitives, three jobs

I deliberately split capability across all three MCP primitives rather than doing everything as tools, because they have different content and trust implications:

- **Tools** (`publish_artifact`, `list_artifacts`, `list_shared_with_me`, `comment_on_artifact`, `link_artifacts`, `set_access_policy`, `revoke_access`, etc.) are for *reasoning and taking action* - metadata-only in and out (IDs, titles, policy summaries, markdown tables), capped at a few KB. Every call runs the same `canView`/`canComment`/`canManagePolicy` checks the API uses, keyed off the caller's own token - never off a link.
- **Resources** (`artifact://<id>`) are for *file content*. This is the only way an agent ever gets bytes back - not through a tool result. A `resources/read` re-authorizes against the caller's token on every single read, so narrowing an artifact's policy revokes agent access exactly as instantly as it revokes a browser session.
- **Prompts** (`summarise_artifact_reviews`) are user-triggered templates (e.g. a slash command in Claude Desktop). The server just fetches the artifact's comments and returns them as prompt messages with an instruction to summarise - the client's own model does the actual summarising. This is the one and only place "AI" touches artifact content, and it deliberately runs on the client's model, not ours (more on this below).

### Presigned links - keeping bytes out of tool calls and the context window

The mechanism I was most careful about is how file bytes move, because a tool result gets fed straight into the model's context - so a naive implementation would burn huge amounts of context (or just fail outright) shipping a multi-MB PDF through a JSON tool response.

- **On publish**, `publish_artifact` never accepts the file inline. The backend hands back a **presigned PUT URL**, and the client uploads the bytes straight to Tigris, out-of-band from the tool call entirely. The tool call itself only ever carries a `bytesRef` correlating the upload to a `finalizeArtifact` call afterwards - metadata in, metadata out.
- **On read**, it's the opposite direction but the same principle: the agent reads the `artifact://<id>` resource, the server does a server-side `GetObject` from Tigris using its own scoped credentials, and returns the blob to the client via the MCP resource protocol. The agent never sees or handles a Tigris URL at all - it's the resource read itself that's authorized, not a link.
- **Presigned URLs are reserved entirely for the browser.** The SPA's own upload/download flows use presigned PUT/GET directly against Tigris (so file bytes never transit our backend as base64 JSON), but that presigned-URL mechanism stays *out* of the MCP path completely. Handing an agent a raw presigned URL would sidestep the token-based authorization check on every subsequent read - so agents always go back through a re-authorized resource read instead.

Net effect: whichever direction the bytes are moving, the agent's own request/response stays small, and the actual heavy lifting happens directly against object storage.

## Where and why I used LLM capabilities

The system has **automatic artifact enrichment**
After every publish (from either the SPA or `publish_artifact`), a background job calls Claude Sonnet via AWS Bedrock to generate a summary, a topic list, proposed tags, and proposed relationships to the owner's other artifacts. It uses the same transactional-outbox worker already used for email delivery, so it needed no new job infrastructure - just one more event type on an existing reliable queue.

Extra care has gone into designing a system that can summarise conversations as part of this metadata enrichment. At present this only analyses .jsonl files as a limitation, but since I wanted to share .jsonl files with this system then this became the priority. 

.jsonl claude log files are deterministically stripped down into metadata + transcript then that transcript is analysed by the llm and added as a conversationSummary metadata field on the artifact.

If I were to extend LLM use further, it would be toward corpus-wide inference rather than per-artifact - weekly digest reports per team, or trend/most-connected-artifact surfacing across the whole collection - both of which are flagged as deliberately deferred in the architecture docs rather than built now.

## Deployment approach
After at first having specified an AWS architecture, I switched gear to a simpler, easier-to-deploy-to architecture with Netlify for the frontend and Fly.io for the backend.

These services provide good logging, security and integrations. Fly.io in particular comes with managed postgres and tigris as easy, free optional extras.

I also opted to use a real email sending service with Resend in Production.

For this project there is no formal CI/CD pipeline which of course for non-demo full project there would need to be.

I deployed both frontend and backend using the cli, assisted by Claude.

## What I'd do with another week

There are many avenues that could be taken with this project.

One of the first things that I would want to do is make the access controls more flexible so that, for example, you can select to send to specific users AND a group. At the moment you are bound to somewhat inflexible choices.

Artifacts also are filterable but we cannot persist organised collections. It would make sense if users wanted to aggregate artifacts that are to do with a particular project in a bucket. They can do this to an extent now with tags and relationships but this model could be extended to have proper collections, shown as collections in the UI.

I would optimise the object storage to have true file size limits, policies on object storage levels, true hard-delete capability, warnings when total storage thresholds are being approached or exceeded.

I would use SES or equivalent enqueueing service in order to truly decouple the backend process from the sending of emails.
