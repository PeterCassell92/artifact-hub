import { computeExpiresAt } from "./policy";

const now = new Date("2026-01-10T00:00:00Z");

describe("computeExpiresAt", () => {
  it("never -> null", () => {
    expect(computeExpiresAt("never", now)).toBeNull();
  });

  it.each([
    ["24h", 24],
    ["7d", 7 * 24],
    ["30d", 30 * 24],
  ] as const)("%s -> now + %d hours", (bucket, hours) => {
    const result = computeExpiresAt(bucket, now);
    expect(result).toEqual(new Date(now.getTime() + hours * 60 * 60 * 1000));
  });
});
