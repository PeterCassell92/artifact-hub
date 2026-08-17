import { inferKindFromFile } from "./kindFromFile";

describe("inferKindFromFile", () => {
  it.each([
    ["diagram.mmd", "text/x-mermaid", "diagram"],
    ["photo.PNG", "image/png", "image"],
    ["painting.kra", "application/x-krita", "image"],
    ["report.pdf", "application/pdf", "document"],
    ["notes.md", "text/markdown", "document"],
    ["dataset.json", "application/json", "data"],
    ["sheet.csv", "text/csv", "data"],
  ])("maps %s (%s) to %s", (fileName, contentType, expected) => {
    expect(inferKindFromFile(fileName, contentType)).toBe(expected);
  });

  it("falls back to contentType when the extension is unrecognized", () => {
    expect(inferKindFromFile("noext", "image/png")).toBe("image");
  });

  it("falls back to 'other' when neither extension nor contentType is recognized", () => {
    expect(inferKindFromFile("archive.zip", "application/zip")).toBe("other");
  });
});
