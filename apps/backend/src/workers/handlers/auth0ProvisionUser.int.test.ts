import type { PrismaClient } from "@prisma/client";
import { jest } from "@jest/globals";
import { startTestDatabase, type TestDatabase } from "../../test-support/testDatabase";
import { resetManagementTokenCache } from "../../adapters/auth0/managementClient";

describe("provisionAuth0User", () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let provisionAuth0User: typeof import("./auth0ProvisionUser").provisionAuth0User;
  let originalFetch: typeof fetch;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = db.prisma;
    ({ provisionAuth0User } = await import("./auth0ProvisionUser"));
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(() => {
    resetManagementTokenCache();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function makeUser() {
    return prisma.user.create({
      data: { email: `invitee-${Math.random()}@test.local`, name: "Test Invitee", status: "active" },
    });
  }

  it("links the Auth0 user_id as idpSub on success", async () => {
    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "mgmt-token", expires_in: 86400 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ user_id: "email|provisioned-123" }),
      } as Response) as unknown as typeof fetch;

    const user = await makeUser();
    expect(user.idpSub).toBeNull();

    await provisionAuth0User({ userId: user.id, email: user.email });

    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.idpSub).toBe("email|provisioned-123");
  });

  it("throws (so the outbox retries) when the payload is malformed", async () => {
    await expect(provisionAuth0User({ userId: "only-a-userId" })).rejects.toThrow();
  });

  it("throws (so the outbox retries) when the Auth0 call fails", async () => {
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    } as Response) as unknown as typeof fetch;

    const user = await makeUser();
    await expect(provisionAuth0User({ userId: user.id, email: user.email })).rejects.toThrow();

    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.idpSub).toBeNull();
  });
});
