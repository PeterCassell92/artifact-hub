import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

type Client = Prisma.TransactionClient | typeof prisma;

export interface EnqueueOutboxEventInput {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * Transactional outbox (docs/architecture/02 §6) — pass a transaction client so the domain
 * change and this row commit atomically. Draining (the actual Resend/Auth0 calls) is Phase 5.
 */
export async function enqueueOutboxEvent(
  input: EnqueueOutboxEventInput,
  client: Client = prisma,
): Promise<void> {
  await client.outboxEvent.create({
    data: {
      type: input.type,
      payload: input.payload as Prisma.InputJsonValue,
      idempotencyKey: input.idempotencyKey,
    },
  });
}
