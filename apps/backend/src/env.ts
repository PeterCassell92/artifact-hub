import { z } from "zod";

/** Parsed, validated environment. Fail fast at boot if misconfigured. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3081), // local dev default (avoids a common :3000 clash); prod pins PORT in fly.toml
  DATABASE_URL: z.string().url(),

  INITIAL_ADMIN_EMAILS: z.string().default(""),

  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_API_AUDIENCE: z.string().min(1),
  AUTH0_MCP_AUDIENCE: z.string().min(1),

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

  // Object storage — Tigris (S3-compatible). `fly storage create` injects these; AWS SDK v3 reads
  // AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION + the custom endpoint automatically.
  BUCKET_NAME: z.string().min(1),
  AWS_ENDPOINT_URL_S3: z.string().url(),
  AWS_REGION: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}
