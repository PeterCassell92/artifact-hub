import { filetypeLabel, formatBytes } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024, "1.0 MB"],
    [1024 * 1024 * 1024, "1.0 GB"],
    [1024 * 1024 * 1024 * 1024, "1024.0 GB"],
  ])("%d -> %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("filetypeLabel", () => {
  it("uses the fileName extension, uppercased", () => {
    expect(filetypeLabel({ fileName: "report.pdf", contentType: "application/pdf" })).toBe("PDF");
  });

  it("falls back to contentType when there's no extension", () => {
    expect(filetypeLabel({ fileName: "README", contentType: "text/plain" })).toBe("text/plain");
  });
});
