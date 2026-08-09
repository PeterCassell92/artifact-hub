import { PrismaClient } from "@prisma/client";

/** Single Prisma client for the process. */
export const prisma = new PrismaClient();
