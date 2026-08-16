import { parseArtifactFilters, serializeArtifactFilters } from "./artifactFilters";

describe("artifactFilters", () => {
  it("round-trips a full filter set through serialize -> URLSearchParams -> parse", () => {
    const original = {
      q: "roadmap",
      sort: "title" as const,
      contentType: ["application/pdf", "image/png"],
      kind: ["diagram" as const],
      tags: ["urgent"],
      sourceTool: ["Claude Desktop"],
      audienceType: ["user_groups" as const],
      isExpired: false,
      publisherId: ["user-1"],
      sinceHours: 24,
    };

    const params = new URLSearchParams(serializeArtifactFilters(original));
    const parsed = parseArtifactFilters(params);

    expect(parsed).toEqual(original);
  });

  it("omits defaulted/empty fields when serializing", () => {
    const params = serializeArtifactFilters({ sort: "published" });
    expect(params).toEqual({});
  });

  it("parses an empty URLSearchParams to an empty filter object", () => {
    expect(parseArtifactFilters(new URLSearchParams())).toEqual({});
  });

  it("splits comma-joined array params back into arrays", () => {
    const parsed = parseArtifactFilters(new URLSearchParams("tags=a,b,c"));
    expect(parsed.tags).toEqual(["a", "b", "c"]);
  });
});
