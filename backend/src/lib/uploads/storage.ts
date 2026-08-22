import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DetectedType } from "./file-type";

/**
 * Object storage, with pre-signed URLs in both directions.
 *
 * ── Why the bytes never pass through this API ─────────────────────────────
 * A multi-megabyte camera photo travelling through Express costs a request
 * slot, a body-parser buffer and the memory to hold it, for the entire duration
 * of an upload over a phone's connection — which on 3G is tens of seconds. A
 * handful of concurrent uploads is enough to starve every other request on the
 * instance. The client PUTs straight to the object store instead; the API only
 * ever issues the permission and validates the result.
 *
 * ── S3-compatible, not a specific vendor ──────────────────────────────────
 * AWS S3, Cloudflare R2, Backblaze B2 and MinIO all speak this API, so the
 * deployment target is a configuration change rather than a rewrite.
 *
 * ── No public objects, ever ───────────────────────────────────────────────
 * Nothing is written with a public ACL. Every read is a fresh, short-lived,
 * signed URL issued only after the API has checked who is asking. An identity
 * document must never be reachable by anyone who merely learns its key.
 */

const BUCKET = process.env.S3_BUCKET;

/** Uploads are unavailable rather than half-working when no bucket is configured. */
export const storageConfigured = Boolean(BUCKET);

/**
 * How long a client has to complete an upload after asking for permission.
 *
 * Long enough for a large file on a bad connection, short enough that a leaked
 * URL is not a durable write capability against our bucket.
 */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/**
 * How long an issued read URL lives.
 *
 * Long enough to load an image, short enough that pasting it into a chat does
 * not hand over lasting access to someone's passport scan.
 */
export const READ_URL_TTL_SECONDS = 300;

let client: S3Client | null = null;

function s3(): S3Client {
  if (!BUCKET) throw new Error("S3_BUCKET is not configured");
  if (client) return client;

  const endpoint = process.env.S3_ENDPOINT;
  client = new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    // Path-style addressing for R2/MinIO, which do not do virtual-host buckets.
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  return client;
}

/**
 * Where an unverified upload lands.
 *
 * Quarantine is not decoration. Between the client's PUT and the server's
 * validation, the object is arbitrary attacker-controlled bytes that happen to
 * be in our bucket — it has not been sniffed, its size has not been checked,
 * and its metadata has not been stripped. Keeping it under a separate prefix
 * means a misconfigured public policy or a bug in a serving path cannot reach
 * it, and a sweep can delete abandoned uploads without touching real documents.
 */
export function quarantineKey(userId: string, documentId: string): string {
  return `quarantine/${userId}/${documentId}`;
}

/**
 * Final key for a verified object.
 *
 * Opaque and unguessable, and never derived from the uploaded filename — a
 * predictable key would let one user probe for another's "passport.jpg", and a
 * user-controlled one is a path-traversal vector against any storage backend
 * that maps keys to paths.
 */
export function durableKey(userId: string, purpose: string, ext: string): string {
  const random = crypto.randomBytes(16).toString("hex");
  return `${purpose}/${userId}/${Date.now()}-${random}${ext}`;
}

export function thumbnailKeyFor(key: string): string {
  return `${key}.thumb.jpg`;
}

/**
 * A URL the client may PUT to, once, for one specific key.
 *
 * `ContentType` is signed in, so the client must send exactly the type it
 * declared — which does not make the declaration trustworthy (the bytes are
 * still sniffed afterwards) but does stop the same URL being reused to write
 * something else.
 *
 * Size is deliberately NOT signed as a condition. A signed ContentLength forces
 * the client to predict its own compressed output byte-exactly, which fails
 * constantly in practice; the real size is measured after upload and an
 * oversized object is deleted then.
 */
export async function presignUpload(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: BUCKET!,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
}

/**
 * A short-lived read URL.
 *
 * `ResponseContentType` pins the type the API verified, so the store cannot be
 * talked into serving the object as something else.
 *
 * `ResponseContentDisposition: attachment` for PDFs is a real mitigation rather
 * than a nicety: a PDF can carry embedded JavaScript, and a browser rendering
 * one inline from a URL executes it in that context. PDFs here are never
 * displayed inline, only downloaded.
 */
export async function presignRead(
  key: string,
  contentType: string,
  filename?: string,
): Promise<string> {
  const isPdf = contentType === "application/pdf";
  const safeName = (filename ?? "document").replace(/[^\w.\-]/g, "_").slice(0, 100);

  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: BUCKET!,
      Key: key,
      ResponseContentType: contentType,
      ...(isPdf
        ? { ResponseContentDisposition: `attachment; filename="${safeName}"` }
        : {}),
    }),
    { expiresIn: READ_URL_TTL_SECONDS },
  );
}

export type ObjectHead = { size: number; contentType?: string };

/** Size and declared type without downloading the object. */
export async function headObject(key: string): Promise<ObjectHead | null> {
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: BUCKET!, Key: key }));
    return { size: res.ContentLength ?? 0, contentType: res.ContentType };
  } catch {
    return null;
  }
}

/**
 * Download an object.
 *
 * `maxBytes` is a hard stop rather than a courtesy: HeadObject reports what the
 * store believes the size to be, and reading without a ceiling would let a
 * mismatch between that and reality exhaust the process's memory.
 */
export async function getObject(key: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET!, Key: key }));
    if (!res.Body) return null;

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > maxBytes) return null;
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: DetectedType | "image/jpeg",
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: BUCKET!,
      Key: key,
      Body: body,
      ContentType: contentType,
      // No ACL. The bucket stays private; reads go through presignRead.
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: BUCKET!, Key: key }));
  } catch {
    /* already gone, or never written */
  }
}

export function storageDescription(): string {
  if (!BUCKET) return "not configured";
  const endpoint = process.env.S3_ENDPOINT;
  return endpoint ? `s3-compatible (${endpoint})` : "aws-s3";
}
