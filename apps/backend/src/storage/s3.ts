import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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

export interface PresignedUploadOptions {
  contentType: string;
  ttlSeconds?: number;
}

/**
 * The MCP `publish_artifact` upload path (docs/architecture/01 decision #44): bytes go straight
 * from the agent's host to Tigris/MinIO via this presigned PUT, never through a tool call.
 */
export function getPresignedUploadUrl(
  storageKey: string,
  { contentType, ttlSeconds = 300 }: PresignedUploadOptions,
): Promise<string> {
  const env = getEnv();
  const command = new PutObjectCommand({
    Bucket: env.BUCKET_NAME,
    Key: storageKey,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(), command, { expiresIn: ttlSeconds });
}

/** Confirms an upload landed (publish_artifact finalize step) — null if the object isn't there yet. */
export async function headObject(storageKey: string): Promise<{ sizeBytes: number } | null> {
  const env = getEnv();
  try {
    const result = await getClient().send(
      new HeadObjectCommand({ Bucket: env.BUCKET_NAME, Key: storageKey }),
    );
    return { sizeBytes: result.ContentLength ?? 0 };
  } catch (err) {
    if (err instanceof NotFound) return null;
    throw err;
  }
}

/** Removes an object that failed a post-upload check (e.g. the `finalizeArtifact` size cap) —
 * the presigned PUT already landed it in storage before the backend got a chance to reject it. */
export async function deleteObject(storageKey: string): Promise<void> {
  const env = getEnv();
  await getClient().send(new DeleteObjectCommand({ Bucket: env.BUCKET_NAME, Key: storageKey }));
}

export interface ObjectBytes {
  buffer: Buffer;
  contentType?: string;
}

/** Server-side GetObject for the `artifact://<id>` MCP Resource (docs/architecture/05 §5) — the
 * only place raw bytes are read by the backend; never presigned, never left to the agent. */
export async function getObjectBuffer(storageKey: string): Promise<ObjectBytes> {
  const env = getEnv();
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: env.BUCKET_NAME, Key: storageKey }),
  );
  const bytes = await result.Body!.transformToByteArray();
  return { buffer: Buffer.from(bytes), contentType: result.ContentType };
}
