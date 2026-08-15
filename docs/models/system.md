# Model — System (OutboxEvent, AdminAuditLog)

Infrastructure-facing models: cross-service reliability and administrative auditing. Note the
**two separate audit trails**: `AdminAuditLog` here (administrative actions) vs. `AccessEvent`
in [`access-event.md`](access-event.md) (artifact access).

---

## OutboxEvent (transactional outbox)

Backs reliable delivery of external side-effects (Resend email, Auth0 provisioning) without an
agent/state-graph framework. See `../architecture/02-auth-identity-and-admin.md` §6.

| Field | Type | Req | Meaning |
|-------|------|:---:|---------|
| `id` | uuid | yes | Event id |
| `type` | string | yes | e.g. `invitation.send` |
| `payload` | json | yes | Data for the external call |
| `status` | enum | yes | `pending` \| `done` \| `failed` |
| `attempts` | int | yes | Retry counter (backoff) |
| `idempotencyKey` | string (unique) | yes | Dedupe key (e.g. invitation id) |
| `createdAt` | timestamp | yes | — |
| `processedAt` | timestamp | no | When drained |

Written in the **same transaction** as the domain change; a worker drains it and performs the
external call idempotently.

## AdminAuditLog (administrative actions)

Security-relevant administrative and ownership actions — **not** artifact reads (those are
`AccessEvent`).

| Field | Type | Req | Meaning |
|-------|------|:---:|---------|
| `id` | uuid | yes | Entry id |
| `actorId` | uuid → User | no | Who performed it (null for system/seed) |
| `action` | string | yes | e.g. `invite.create`, `invitation.accept`, `role.change`, `user.group_change`, `user.disable`, `policy.update`, `share_link.create`, `share_link.revoke` |
| `targetType` | string | yes | e.g. `user`, `artifact`, `invitation` |
| `targetId` | string | yes | The affected entity |
| `metadata` | json | no | Before/after (e.g. old→new role/groups), context |
| `createdAt` | timestamp | yes | — |

Indexed by `(targetType, targetId)` to answer "show the admin history for this user/artifact."
Includes **promote/demote** (`role.change`) and **policy revocation** (`policy.update`).

## Why two audit models

- `AccessEvent` is high-volume, per-read, and answers "who *viewed/downloaded* this artifact and
  how" — including via MCP and share links.
- `AdminAuditLog` is low-volume, per-administrative-action, and answers "who *changed* access,
  roles, groups, or memberships."

Keeping them separate keeps each query fast and each concern clear.
