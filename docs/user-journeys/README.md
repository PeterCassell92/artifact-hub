# User Journeys (BDD)

Executable-spec target for Artifact Hub, written as Gherkin `.feature` files per
[cucumber.io/docs/bdd](https://cucumber.io/docs/bdd/). Each scenario traces back to a
requirement in [`../architecture/01-overview.md`](../architecture/01-overview.md) §7 and to a
test layer in [`../architecture/09-testing-strategy.md`](../architecture/09-testing-strategy.md).

Step definitions are future implementation work; these files define the intended behaviour.

| File | Actor | Covers |
|------|-------|--------|
| `publisher-publish-with-policy.feature` | Publisher (User A) | Publish via MCP with group audience + 7-day expiry |
| `publisher-revoke-and-my-artifacts.feature` | Publisher (User A) | Owner retains access after expiry; comments visible |
| `reviewer-access-via-ui.feature` | Reviewer (User B) | Login → view/download → read/add comment |
| `reviewer-access-via-mcp.feature` | Reviewer (User B) | "Shared with me in 24h" table + Resource download |
| `admin-invite-user.feature` | Admin | Email invite into a group; immutable membership |
| `admin-promote-user.feature` | Admin | Promote/demote existing users; last-admin guardrail |
| `access-denied-after-expiry.feature` | Reviewer (User B) | Old link denied once expired/revoked |
