import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "../env";

/**
 * S3-compatible object store client (MinIO in dev, Tigris in prod — docs/architecture/07).
 * Credentials are read by the AWS SDK's own default provider chain from
 * AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (see env.ts's comment on BUCKET_NAME) — not passed
 * explicitly here. `forcePathStyle` is required for MinIO; harmless for Tigris.
 */
let client: S3Client | undefined;
function getClient(): S3Client {
  if (!client) {
    const env = getEnv();
    client = new S3Client({
      endpoint: env.AWS_ENDPOINT_URL_S3,
      region: env.AWS_REGION,
      forcePathStyle: true,
    });
  }
  return client;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/["\r\n]/g, "");
}

export interface PresignedDownloadOptions {
  contentType: string;
  fileName: string;
  ttlSeconds?: number;
}

/** Browser download path only (docs/architecture/03 §6) — never used by the MCP resource path. */
export function getPresignedDownloadUrl(
  storageKey: string,
  { contentType, fileName, ttlSeconds = 60 }: PresignedDownloadOptions,
): Promise<string> {
  const env = getEnv();
  const command = new GetObjectCommand({
    Bucket: env.BUCKET_NAME,
    Key: storageKey,
    ResponseContentType: contentType,
    ResponseContentDisposition: `inline; filename="${sanitizeFileName(fileName)}"`,
  });
  return getSignedUrl(getClient(), command, { expiresIn: ttlSeconds });
}
