import { z } from "zod";

/** Parsed, validated environment. Fail fast at boot if misconfigured. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3081), // local dev default (avoids a common :3000 clash); prod pins PORT in fly.toml
  DATABASE_URL: z.string().url(),

  INITIAL_ADMIN_EMAILS: z.string().default(""),

  // The SPA's public origin — used to build absolute share-link (03 §5) and invitation-accept
  // (02 §4) URLs (`${APP_ORIGIN}/s/<token>`, `${APP_ORIGIN}/accept-invite?token=<token>`).
  // Dev default matches the Vite dev server port (dev-and-testing-phases-guide.md).
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),

  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_API_AUDIENCE: z.string().min(1),
  // Must be an absolute URI (RFC 8707 + MCP spec, docs/architecture/02 §1) — it also doubles as
  // this resource's own URL for RFC 9728 Protected Resource Metadata (adapters/mcp/discovery.ts).
  AUTH0_MCP_AUDIENCE: z.string().url(),

  // Auth0 Management API (a SEPARATE Machine-to-Machine app, not the SPA client). Used only at
  // invitation-accept to create/enable the Auth0 user (docs/architecture/02 §4/§6). Optional so the
  // backend boots for login-only local runs; the invitation-provisioning code must assert both are
  // set before calling the Management API. Dev: from the M2M app authorized for the Management API.
  // Prod: `fly secrets`, never committed.
  AUTH0_MGMT_CLIENT_ID: z.string().optional(),
  AUTH0_MGMT_CLIENT_SECRET: z.string().optional(),

  // Email is SMTP everywhere: MailCatcher (no auth) in dev, Resend (auth) in prod. No `ses` branch.
  EMAIL_TRANSPORT: z.enum(["smtp"]).default("smtp"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(), // Resend: "resend"; unset for MailCatcher
  SMTP_PASS: z.string().optional(), // Resend API key (a fly secret); unset for MailCatcher
  EMAIL_FROM: z.string().default("Artifact Hub <no-reply@artifact-hub.local>"),

  // Transactional outbox drain loop (02 §6) — in-process poller, no extra infra. Polling this
  // often is cheap (indexed SELECT on a low-volume table); the default favors timely invite emails.
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().default(3000),

  // Object storage — Tigris (S3-compatible). `fly storage create` injects these; AWS SDK v3 reads
  // AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION + the custom endpoint automatically.
  BUCKET_NAME: z.string().min(1),
  AWS_ENDPOINT_URL_S3: z.string().url(),
  AWS_REGION: z.string().min(1),

  // Dev/test-only auth shortcut (docs/development/bruno-mcp-token.md, 09 §3-4). Never used in
  // production — the RS validator only trusts real Auth0 JWKS there. Required outside production
  // (see superRefine below) so the shared test-token helper and POST /test/mcp-token always have a
  // signing key + guard secret to use.
  TEST_JWT_SIGNING_SECRET: z.string().optional(),
  TEST_MINT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

const RequiredOutsideProd = EnvSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV === "production") return;
  for (const key of ["TEST_JWT_SIGNING_SECRET", "TEST_MINT_SECRET"] as const) {
    if (!env[key]) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `${key} is required outside production (dev/test token signing)`,
      });
    }
  }
});

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) cached = RequiredOutsideProd.parse(process.env);
  return cached;
}
