# Model — Identity (User, Group, GroupMembership, Invitation)

The authorization subjects and the onboarding record. Auth is **passwordless / magic link**, so
there is no password anywhere. See
[`../architecture/02-auth-identity-and-admin.md`](../architecture/02-auth-identity-and-admin.md).

---

## User

| Field | Type | Req | Meaning | Filterable? |
|-------|------|:---:|---------|:-----------:|
| `id` | uuid | yes | User id (referenced as `ownerId`, `authorId`, etc.) | — |
| `idpSub` | string | no | Auth0 subject; null until first magic-link sign-in | — |
| `email` | string (unique) | yes | Login identity + invite target | search (admin) |
| `name` | string | **yes** | Display name (shown on comments, publisher column) — every user must have one; admin-provided at invite time (`CreateInvitationInput.name` is required); seeded/defensive-fallback rows derive a placeholder from the email local-part (`nameFromEmail`) | search (admin) |
| `avatarUrl` | string | no | Optional avatar | — |
| `role` | enum | yes | `member` \| `admin` (promote/demote by admin) | yes (admin) |
| `status` | enum | yes | `invited` \| `active` \| `disabled` | yes (admin) |
| `createdAt` | timestamp | yes | — | — |

No password field. Sign-in is via Auth0's passwordless (email link) connection.

## Group

| Field | Type | Req | Meaning |
|-------|------|:---:|---------|
| `id` | uuid | yes | Group id |
| `name` | string (unique) | yes | e.g. `Product`, `Development` |
| `description` | string | no | Optional |
| `createdAt` | timestamp | yes | — |

## GroupMembership (immutable to the user)

| Field | Type | Req | Meaning |
|-------|------|:---:|---------|
| `userId` | uuid → User | yes | Member |
| `groupId` | uuid → Group | yes | Group |
| `addedAt` | timestamp | yes | — |

Assigned by an admin at invite time; **only an admin can change it** (no self-service). Backs the
`user_groups` audience in the access policy.

## Invitation

| Field | Type | Req | Meaning |
|-------|------|:---:|---------|
| `id` | uuid | yes | Invite id |
| `email` | string | yes | Invitee |
| `role` | enum | yes | Role to grant on accept (`member` \| `admin`) |
| `groupIds` | uuid[] | no | Groups to assign on accept (immutable thereafter) |
| `tokenHash` | string (unique) | yes | SHA-256 of the emailed token; raw token only in the link |
| `status` | enum | yes | `pending` \| `accepted` \| `expired` \| `revoked` |
| `invitedById` | uuid → User | yes | The inviting admin |
| `expiresAt` | timestamp | yes | Invite validity window |
| `acceptedAt` | timestamp | no | When accepted |
| `createdAt` | timestamp | yes | — |

Accepting sets **no password** (passwordless) — it provisions the account + immutable groups; the
user then signs in via magic link.
