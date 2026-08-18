import { getPresignedDownloadUrl, getPresignedUploadUrl } from "./s3";

/**
 * Regression tests for the AWS SDK v3 flexible-checksums default (v3.729.0+): with
 * requestChecksumCalculation left at WHEN_SUPPORTED, presigning a PutObjectCommand signs an
 * x-amz-checksum-crc32 of the empty presign-time body (AAAAAA==) into the URL, so any real
 * upload fails checksum validation on stores that enforce it (Tigris/S3; MinIO ignores it).
 * The client must be configured with WHEN_REQUIRED — these tests pin that behavior.
 * Presigning is local signature computation, so no object store is needed.
 */
describe("getPresignedUploadUrl", () => {
  it("carries no checksum parameters (would be the CRC32 of an empty body)", async () => {
    const url = new URL(
      await getPresignedUploadUrl("test/upload.pdf", { contentType: "application/pdf" }),
    );
    expect(url.searchParams.get("x-amz-checksum-crc32")).toBeNull();
    expect(url.searchParams.get("x-amz-sdk-checksum-algorithm")).toBeNull();
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("signs the expected upload parameters", async () => {
    const url = new URL(
      await getPresignedUploadUrl("test/upload.pdf", { contentType: "application/pdf" }),
    );
    expect(url.pathname).toBe("/artifact-hub-dev/test/upload.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });
});

describe("getPresignedDownloadUrl", () => {
  it("carries no checksum parameters", async () => {
    const url = new URL(
      await getPresignedDownloadUrl("test/download.pdf", {
        contentType: "application/pdf",
        fileName: "report.pdf",
      }),
    );
    expect(url.searchParams.get("x-amz-checksum-mode")).toBeNull();
    expect(url.searchParams.get("x-amz-checksum-crc32")).toBeNull();
  });
});
