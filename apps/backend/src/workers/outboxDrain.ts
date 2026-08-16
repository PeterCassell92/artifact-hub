import type { OutboxEvent } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../logger";

export type OutboxHandler = (payload: Record<string, unknown>) => Promise<void>;

const MAX_ATTEMPTS = 5;

/**
 * Claims a batch of pending rows via a single atomic UPDATE ... SKIP LOCKED (docs/architecture/02
 * §6): safe if more than one machine ends up running this loop (fly.toml can scale past
 * min_machines_running=1) — concurrent claims never grab the same row.
 */
export async function claimPendingOutboxEvents(batchSize: number): Promise<OutboxEvent[]> {
  return prisma.$queryRaw<OutboxEvent[]>`
    UPDATE "OutboxEvent"
    SET status = 'processing'
    WHERE id IN (
      SELECT id FROM "OutboxEvent"
      WHERE status = 'pending'
      ORDER BY "createdAt"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `;
}

/** Pure so it's unit-testable without a database: decides the row's next state after a failed attempt. */
export function nextAttemptState(
  attempts: number,
  maxAttempts: number = MAX_ATTEMPTS,
): { status: "pending" | "failed"; attempts: number } {
  const nextAttempts = attempts + 1;
  return { status: nextAttempts >= maxAttempts ? "failed" : "pending", attempts: nextAttempts };
}

/** One drain pass: claim a batch, dispatch each by `type`, mark done/retry/failed. */
export async function drainOutboxOnce(handlers: Record<string, OutboxHandler>, batchSize = 20): Promise<void> {
  const claimed = await claimPendingOutboxEvents(batchSize);

  for (const event of claimed) {
    try {
      const handler = handlers[event.type];
      if (!handler) throw new Error(`no outbox handler registered for type "${event.type}"`);
      await handler(event.payload as Record<string, unknown>);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "done", processedAt: new Date() },
      });
    } catch (err) {
      const { status, attempts } = nextAttemptState(event.attempts);
      logger.error({ err, outboxEventId: event.id, type: event.type, attempts, status }, "outbox event failed");
      await prisma.outboxEvent.update({ where: { id: event.id }, data: { status, attempts } });
    }
  }
}

/** Starts the in-process poller (docs/architecture/02 §6, 07 §6). Returns a stop function. */
export function startOutboxDrainLoop(
  handlers: Record<string, OutboxHandler>,
  intervalMs: number,
): () => void {
  const timer = setInterval(() => {
    drainOutboxOnce(handlers).catch((err) => logger.error({ err }, "outbox drain tick failed"));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
