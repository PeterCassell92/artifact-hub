import { inferContentType, isTextLike } from "./contentType";

describe("isTextLike", () => {
  it.each([
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "application/toml",
    "application/sql",
    "application/jsonl",
    "application/x-ndjson",
    "application/x-jsonlines",
    "application/javascript",
    "application/x-sh",
    "image/svg+xml", // covered via the +xml suffix
    "application/vnd.api+json",
  ])("treats %s as text-like", (contentType) => {
    expect(isTextLike(contentType)).toBe(true);
  });

  it.each(["application/pdf", "image/png", "application/octet-stream", "application/zip"])(
    "does not treat %s as text-like",
    (contentType) => {
      expect(isTextLike(contentType)).toBe(false);
    },
  );
});

describe("inferContentType", () => {
  it.each([
    ["session-log.jsonl", "application/octet-stream", "application/jsonl"],
    ["notes.md", "application/octet-stream", "text/markdown"],
    ["diagram.mmd", "", "text/x-mermaid"],
    ["script.py", "binary/octet-stream", "text/x-python"],
    ["data.yaml", "application/x-binary", "application/yaml"],
  ])("corrects %s declared as %s to %s", (fileName, declared, expected) => {
    expect(inferContentType(fileName, declared)).toBe(expected);
  });

  it("leaves an unrecognized extension's low-confidence declared type unchanged", () => {
    expect(inferContentType("mystery.xyz123", "application/octet-stream")).toBe("application/octet-stream");
  });

  it("never overrides a declared type that isn't low-confidence, even if the extension disagrees", () => {
    expect(inferContentType("notes.md", "application/pdf")).toBe("application/pdf");
  });

  it("leaves an extensionless file's low-confidence declared type unchanged", () => {
    expect(inferContentType("README", "application/octet-stream")).toBe("application/octet-stream");
  });
});
