import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";

// apps/backend/src/test-support -> apps/backend
const BACKEND_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");

export interface TestDatabase {
  prisma: PrismaClient;
  databaseUrl: string;
  stop: () => Promise<void>;
}

/**
 * Spins up an ephemeral Postgres (Testcontainers, 09 §3) and applies the committed migrations —
 * never `migrate dev` in tests (prisma-migrate skill). Sets process.env.DATABASE_URL so a
 * subsequently (dynamically) imported ../app / ../db picks it up — see the *.int.test.ts files
 * for why the import must happen after this resolves.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:16").start();
  const databaseUrl = container.getConnectionUri();
  process.env.DATABASE_URL = databaseUrl;

  execSync("npx --no-install prisma migrate deploy", {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  return {
    prisma,
    databaseUrl,
    stop: async () => {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}
