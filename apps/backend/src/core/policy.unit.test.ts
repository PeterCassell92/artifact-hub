import { computeExpiresAt, newlyGrantedIds } from "./policy";

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

describe("newlyGrantedIds", () => {
  it("empty before -> everything in after is new", () => {
    expect(newlyGrantedIds([], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("no overlap change -> nothing new", () => {
    expect(newlyGrantedIds(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("narrowing (fewer ids in after) never reports false positives", () => {
    expect(newlyGrantedIds(["a", "b", "c"], ["a"])).toEqual([]);
  });

  it("only reports ids absent from before, order preserved from after", () => {
    expect(newlyGrantedIds(["a"], ["b", "a", "c"])).toEqual(["b", "c"]);
  });

  it("before === after -> []", () => {
    expect(newlyGrantedIds(["a", "b"], ["a", "b"])).toEqual([]);
  });
});
