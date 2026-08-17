import { canManagePolicy, canView, type ArtifactPolicy, type Viewer } from "./authz";

const now = new Date("2026-01-10T00:00:00Z");
const future = new Date("2026-02-01T00:00:00Z");
const past = new Date("2026-01-01T00:00:00Z");

const activeViewer = (over: Partial<Viewer> = {}): Viewer => ({
  id: "u-viewer",
  status: "active",
  groupIds: [],
  ...over,
});

const policy = (over: Partial<ArtifactPolicy> = {}): ArtifactPolicy => ({
  ownerId: "u-owner",
  audienceType: "specific_users",
  expiresAt: future,
  allowedUserIds: [],
  allowedGroupIds: [],
  revoked: false,
  ...over,
});

describe("canView", () => {
  it("owner always sees their artifact, even after expiry", () => {
    const owner = activeViewer({ id: "u-owner" });
    expect(canView(owner, policy({ expiresAt: past }), now).allowed).toBe(true);
  });

  it("blocks disabled users, including the owner", () => {
    const disabledOwner = activeViewer({ id: "u-owner", status: "disabled" });
    expect(canView(disabledOwner, policy(), now)).toEqual({
      allowed: false,
      reason: "disabled",
    });
  });

  it("public_authenticated allows any active viewer", () => {
    expect(
      canView(activeViewer(), policy({ audienceType: "public_authenticated" }), now)
        .allowed,
    ).toBe(true);
  });

  it("specific_users allows only listed users", () => {
    const p = policy({ allowedUserIds: ["u-viewer"] });
    expect(canView(activeViewer(), p, now).allowed).toBe(true);
    expect(canView(activeViewer({ id: "u-other" }), p, now)).toEqual({
      allowed: false,
      reason: "not_in_audience",
    });
  });

  it("user_groups allows on group intersection", () => {
    const p = policy({ audienceType: "user_groups", allowedGroupIds: ["g-product"] });
    expect(canView(activeViewer({ groupIds: ["g-product"] }), p, now).allowed).toBe(true);
    expect(canView(activeViewer({ groupIds: ["g-other"] }), p, now)).toEqual({
      allowed: false,
      reason: "not_in_audience",
    });
  });

  it("denies a non-owner once expired", () => {
    const p = policy({ audienceType: "public_authenticated", expiresAt: past });
    expect(canView(activeViewer(), p, now)).toEqual({ allowed: false, reason: "expired" });
  });

  it("denies a non-owner once revoked, even with a valid audience/expiry", () => {
    const p = policy({ audienceType: "public_authenticated", expiresAt: future, revoked: true });
    expect(canView(activeViewer(), p, now)).toEqual({ allowed: false, reason: "revoked" });
  });

  it("still lets the owner in once revoked — they need access to re-open it", () => {
    const owner = activeViewer({ id: "u-owner" });
    expect(canView(owner, policy({ revoked: true }), now).allowed).toBe(true);
  });
});

describe("canManagePolicy", () => {
  it("only the active owner can manage", () => {
    expect(canManagePolicy(activeViewer({ id: "u-owner" }), policy())).toBe(true);
    expect(canManagePolicy(activeViewer({ id: "u-other" }), policy())).toBe(false);
    expect(
      canManagePolicy(activeViewer({ id: "u-owner", status: "disabled" }), policy()),
    ).toBe(false);
  });
});
