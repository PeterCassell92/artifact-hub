import { PrismaClient } from "@prisma/client";
import { getEnv } from "./env";

/** Single Prisma client for the process. */
export const prisma = new PrismaClient({ datasourceUrl: getEnv().DATABASE_URL });
