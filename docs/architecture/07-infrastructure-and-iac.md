# 07 — Infrastructure & Infrastructure-as-Code

*Status: design. Related: [06](06-api-design.md), [08](08-deployment-pipeline.md),
[10](10-observability.md).*

Everything runs in one AWS account, provisioned with **Terraform** so the whole system is one
reproducible stack. High concurrency is a system requirement — the compute tier autoscales
behind an ALB.

---

## 1. AWS topology

```
                       Route 53 (app + api + sandbox domains)
                          │            │              │
             CloudFront (SPA)   CloudFront (sandbox)   ACM certs
                  │  origin           │ origin
                  ▼                   ▼
             S3 (static site)    S3 (artifacts, private, Block Public Access)
                                     ▲          ▲
                    presigned (60s)  │          │ server-side GetObject (IAM role)
   Internet ─▶ ALB (TLS) ─▶ ECS Fargate service (Backend, N replicas, autoscaled)
                                     │           │            │
                              Prisma │     IAM   │      Mgmt API / OIDC / SES
                                     ▼           ▼            ▼
                            RDS Postgres    (S3 above)    Auth0 (ext) + SES
                            (private subnet)
                                     ▲
                          Secrets Manager (DB creds, Auth0 secret, SES identity)
                          CloudWatch (logs/metrics/alarms), ECR (images)
```

- **VPC** with public subnets (ALB, NAT) and private subnets (ECS tasks, RDS).
- **RDS Postgres** in **private** subnets only — never publicly reachable; the backend reaches
  it inside the VPC.
- **S3 artifacts bucket** fully private (Block Public Access on); reads only via presigned URL
  (browser) or IAM-role server-side (MCP resource).
- **IAM roles, not long-lived keys**: the ECS task role grants least-privilege S3, Secrets
  Manager, SES, and (scoped) Auth0-secret access.

---

## 2. Terraform module layout

```
infra/
├── modules/
│   ├── network/          VPC, subnets, route tables, NAT, security groups
│   ├── data/             RDS Postgres, subnet group, parameter group, backups
│   ├── compute/          ECR, ECS cluster+service, task def, ALB, target group, autoscaling
│   ├── frontend/         S3 site bucket, CloudFront (app), ACM, Route 53 records
│   ├── sandbox/          S3/CloudFront sandbox origin + CSP for HTML artifacts
│   ├── email/            SES domain identity, DKIM, verified sender
│   ├── secrets/          Secrets Manager entries (DB, Auth0, SES) + IAM policy
│   └── observability/    CloudWatch log groups, dashboards, alarms, (Sentry config out-of-band)
├── envs/
│   ├── dev/              main.tf (module wiring) + dev.tfvars
│   └── prod/             main.tf + prod.tfvars
└── backend.tf            remote state: S3 bucket + DynamoDB lock table
```

- **Remote state** in S3 with a DynamoDB lock table; separate state per environment.
- **Environments** `dev` and `prod` wire the same modules with different sizing/vars.
- **Config/secrets** flow: non-secret config as Terraform vars / SSM Parameter Store; secrets in
  Secrets Manager (`INITIAL_ADMIN_EMAILS`, Auth0 client secret + Management API creds, DB
  password, SES sender). The ECS task reads them at boot / via the AWS SDK.

---

## 3. Compute & concurrency

- **ECS Fargate** service running the backend container (Express serving `/api/*` + `/mcp`).
- **ALB** terminates TLS (ACM cert), health-checks `GET /readyz`, and load-balances across tasks.
- **Autoscaling** on CPU/target-tracking (and/or ALB request count per target) to satisfy the
  high-concurrency requirement. Streamable HTTP `/mcp` is stateless-friendly, so it scales
  horizontally the same as the API.
- **Why not Lambda for `/mcp`**: long-running container suits OAuth flows + streaming better and
  avoids cold-start/timeout friction on the MCP endpoint.

---

## 4. Storage & cost optimisation at scale

- Artifacts are **write-once** (no edit/delete in v1), which suits **S3 lifecycle**
  transitions: e.g. `Standard → Standard-IA` after N days, `→ Glacier Instant Retrieval` for
  cold artifacts, to cut cost as the corpus grows. Encoded in the `data`/`frontend`… actually
  the **artifacts bucket** module (part of `compute`/`data` wiring or its own `storage` module).
- **S3 versioning** (deferred prod-hardening) can be enabled later for accidental-overwrite
  protection; not needed for write-once v1.
- **RDS automated backups** enabled; retention set per environment.

---

## 5. Networking & security summary

- RDS: private subnet, security group allows only the ECS task SG on 5432.
- S3: Block Public Access; bucket policy denies non-TLS; access via presigned/IAM only.
- Secrets: never in env files or images; Secrets Manager + task role.
- CloudFront: separate distributions for the SPA and the HTML sandbox origin (isolation, `03`§7).
- ACM certs + Route 53 for `app.`, `api.`, and `sandbox.` hostnames.

---

## 6. Reliability building blocks (no LangGraph)

- The **transactional outbox** (see `02` §6) is just DB rows + a drain loop in the backend — no
  extra infrastructure beyond the existing RDS. External calls (SES, Auth0) are retried with
  idempotency keys.
- Health/readiness endpoints gate ALB traffic and rolling deploys (`08`).

---

## 7. What Terraform provisions vs. configured elsewhere

- **Terraform**: VPC, RDS, S3 (site + artifacts + sandbox), CloudFront, ALB, ECS, ECR, SES
  identity, Secrets Manager entries, IAM roles/policies, Route 53, ACM, CloudWatch dashboards/alarms.
- **Out of band (documented, not Terraformed in v1)**: the Auth0 tenant (applications, API,
  DCR, Management API app) — created in Auth0 and referenced by secret; Sentry project.
