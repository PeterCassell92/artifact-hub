# Fly.io / Tigris production costs

*Status: dev process. Related: [`../development/deploy-runbook.md`](../development/deploy-runbook.md)
(provisioning + deploy steps), [`../architecture/07-infrastructure-and-iac.md`](../architecture/07-infrastructure-and-iac.md)
(topology).*

What the production stack actually costs, so a short-lived deployment (e.g. a demo hosted for a
day or two) has a known bill instead of a surprise one. Prices as checked 2026-08-17 — always
confirm current rates against the linked pricing pages before relying on this for a long-lived
deployment.

## Fly Managed Postgres (`fly mpg create`)

`fly mpg create` does **not** prompt for a plan — it silently defaults to **Basic**
(shared-cpu-2x, 1GB RAM) at **$38/month**, billed prorated/hourly. There is no documented free
tier for Fly Managed Postgres.

- For a demo hosted a day or two, the prorated cost is small (a few dollars) and may fall under
  Fly's small-usage free allowance — but confirm current Fly billing policy yourself, this repo's
  docs don't assert a number.
- To avoid this default, either pass an explicit lower-cost flag/plan when creating the cluster
  interactively, or use the older *unmanaged* Postgres-on-Fly-Machines offering (`fly postgres
  create`), which lets you pick a smaller `shared-cpu-1x` VM size at create time.
- **Destroy the cluster when done** if this is a short-lived deployment:
  `fly mpg destroy --cluster <cluster-id>` (see `fly mpg list -o personal` for the ID).

## Tigris object storage (`fly storage create`)

Billed **through your Fly account** — no separate Tigris invoice. Pricing (from
[tigrisdata.com/pricing](https://www.tigrisdata.com/pricing/)):

| Item | Cost |
|---|---|
| Standard storage | $0.02/GB/month |
| Class A requests (uploads, copies, list) | $0.005 per 1,000 |
| Class B requests (downloads, metadata) | $0.0005 per 1,000 |
| Egress (data out to the internet) | **$0** — Tigris does not charge for egress |
| Deletes | Free |

**Free tier (new users):** 5 GB Standard storage, 10,000 Class A requests, 100,000 Class B
requests — per month. A short demo with a handful of test artifacts stays comfortably inside this
free allowance; Tigris is not the cost driver for a short-lived deployment — Postgres is.

## Fly app machines (`fly.toml`)

`shared-cpu-1x`, 512MB, `min_machines_running = 1` (per the committed `fly.toml`, to avoid a cold
start on the `/mcp` OAuth path). Check current Fly Machines pricing at
[fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/) before a longer-lived deployment —
not re-derived here since it wasn't priced out as part of this pass.

## Takeaway for a short-lived (1–2 day) demo deployment

- **Postgres is the real cost** (~$38/mo prorated to the days actually running) — destroy the
  cluster (`fly mpg destroy`) as soon as the demo is done rather than leaving it running.
- **Tigris storage is effectively free** at demo scale.
- Netlify's free tier comfortably covers the SPA.
