import type { PrismaClient } from "@prisma/client";
import { startTestDatabase, type TestDatabase } from "../test-support/testDatabase";

describe("outbox drain loop (docs/architecture/02 §6)", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let claimPendingOutboxEvents: typeof import("./outboxDrain").claimPendingOutboxEvents;
  let drainOutboxOnce: typeof import("./outboxDrain").drainOutboxOnce;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = db.prisma;
    ({ claimPendingOutboxEvents, drainOutboxOnce } = await import("./outboxDrain"));
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  async function enqueue(type: string) {
    return prisma.outboxEvent.create({
      data: { type, payload: { hello: "world" }, idempotencyKey: `test:${Math.random()}` },
    });
  }

  it("dispatches a pending row to its handler and marks it done", async () => {
    const event = await enqueue("test.succeed");
    const seen: Record<string, unknown>[] = [];

    await drainOutboxOnce({ "test.succeed": async (payload) => void seen.push(payload) });

    expect(seen).toEqual([{ hello: "world" }]);
    const updated = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.status).toBe("done");
    expect(updated.processedAt).not.toBeNull();
  });

  it("retries a failing handler, then marks the row failed once attempts are exhausted", async () => {
    const event = await enqueue("test.fail");
    const handlers = {
      "test.fail": async () => {
        throw new Error("boom");
      },
    };

    // MAX_ATTEMPTS is 5 (outboxDrain.ts) — five ticks exhausts retries.
    for (let i = 0; i < 5; i++) {
      await drainOutboxOnce(handlers);
    }

    const updated = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.status).toBe("failed");
    expect(updated.attempts).toBe(5);
  });

  it("treats an unregistered type as a failure (retries, then fails) instead of dropping it", async () => {
    const event = await enqueue("test.unregistered");

    for (let i = 0; i < 5; i++) {
      await drainOutboxOnce({});
    }

    const updated = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.status).toBe("failed");
  });

  it("never lets two concurrent claims grab the same row (SKIP LOCKED)", async () => {
    const events = await Promise.all([enqueue("test.race"), enqueue("test.race"), enqueue("test.race")]);

    const [batchA, batchB] = await Promise.all([
      claimPendingOutboxEvents(2),
      claimPendingOutboxEvents(2),
    ]);

    const claimedIds = [...batchA, ...batchB].map((e) => e.id);
    expect(new Set(claimedIds).size).toBe(claimedIds.length); // no id claimed twice
    expect(claimedIds.length).toBeLessThanOrEqual(events.length);
  });
});
