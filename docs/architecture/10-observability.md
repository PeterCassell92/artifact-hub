# 10 — Observability & Operations

*Status: design. Related: [07](07-infrastructure-and-iac.md), [08](08-deployment-pipeline.md).*

What we can see, measure, and be alerted on. v1 ships the essentials (structured logs, health,
core metrics, error tracking, audit logging); the rest is marked deferred.

---

## 1. Structured logging (v1)

- **JSON logs** to stdout — collected by **Fly** and viewable with `fly logs` (optionally shipped
  to an external sink via a Fly log shipper). No platform-specific log driver.
- Every log line carries a **correlation id**: a request id generated at `fly-proxy`/the edge or the
  Express middleware, propagated through `core`, and echoed to the MCP adapter (per JSON-RPC
  call). This ties an API/MCP request to its DB / object-store (Tigris) / Resend effects.
- Include: `requestId`, `userId` (when authed), `route`/`tool`, `status`, `latencyMs`. **Never**
  log tokens, file bytes, or PII beyond `userId`/email where necessary.

## 2. Metrics (v1)

- **RED** per surface (API routes and MCP tools): **R**ate, **E**rrors, **D**uration.
- **Per-MCP-tool counters** (`publish_artifact`, `list_shared_with_me`, resource reads, …) so we
  can see agent usage distinctly from browser usage.
- Infra metrics via Fly's managed **Prometheus + Grafana**: Fly machine CPU/memory, `fly-proxy`
  request count / 5xx / latency, and Fly Managed Postgres metrics
  (connections/CPU/storage).
- Surfaced on the **managed Grafana dashboards** Fly provides out of the box.

## 3. Health & readiness (v1)

- `GET /healthz` — liveness (process up).
- `GET /readyz` — readiness: DB reachable + migrations applied. Wired to the **Fly health check**
  so unhealthy machines are drained and rolling deploys only shift traffic to ready machines (`08`).

## 4. Error tracking (v1)

- **Sentry** (or equivalent) in the backend and SPA for exception capture with the `requestId`
  attached, so a user-facing error links to server context. Sentry DSN via `fly secrets`.

## 5. Audit logging (v1 — security-relevant)

Written to the `audit_log` table (`04` §2) for security-relevant actions:

- `invite.create` (who invited whom, into which groups + role),
- `invitation.accept`,
- `user.group_change` / `user.role_change` / `user.disable` (admin corrective actions),
- `policy.update` (revocation / audience/expiry change on an artifact),
- `share_link.create` / `share_link.revoke`.

Audit entries are queryable by target (`(targetType, targetId)` index) — e.g. "show the access
history for this artifact."

## 6. Tracing (v1-optional)

- **OpenTelemetry** traces for API + MCP requests → any OTLP backend. Nice for latency breakdowns
  across DB / object store (Tigris) / Resend; optional for v1, low effort to add given the
  correlation id already exists.

---

## 7. Alerting

Alarms via **Fly metrics alerts / Grafana alerting** (email/Slack), with **Sentry** for error spikes:

- API/MCP 5xx rate above threshold; p95 latency regression.
- Fly machine unhealthy / restart loop; app can't reach desired machine count.
- Fly Managed Postgres high CPU / low free storage / connection saturation.
- Outbox backlog growing (invitations/emails not draining) — signals Resend/Auth0 trouble.

---

## 8. Deferred (prod-hardening — note now, add later)

- **Rate limiting / abuse protection** on `/s/:token` redemption and `/mcp` (and login).
- **Backups**: Fly Managed Postgres automated backups tuned; Tigris object versioning/immutability
  (write-once) for accidental-overwrite protection.
- **CDN hardening**: signed URLs / short-TTL tokens if we ever move file delivery behind a CDN.
- **Upload validation at scale**: size caps, MIME sniffing/validation, content moderation/scanning.
- **SLOs & on-call**: formal SLOs, runbooks, paging rotation.
