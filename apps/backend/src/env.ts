import { z } from "zod";

/** Parsed, validated environment. Fail fast at boot if misconfigured. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),

  INITIAL_ADMIN_EMAILS: z.string().default(""),

  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_API_AUDIENCE: z.string().min(1),
  AUTH0_MCP_AUDIENCE: z.string().min(1),

  EMAIL_TRANSPORT: z.enum(["smtp", "ses"]).default("smtp"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  EMAIL_FROM: z.string().default("Artifact Hub <no-reply@artifact-hub.local>"),

  S3_BUCKET: z.string().min(1),
  AWS_REGION: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}
