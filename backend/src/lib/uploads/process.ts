import crypto from "node:crypto";
import sharp from "sharp";
import {
  sniffFileType,
  extensionFor,
  MAX_UPLOAD_BYTES,
  formatBytes,
  type DetectedType,
} from "./file-type";
import { stripMetadata, containsExif } from "./metadata";
import {
  getObject,
  headObject,
  putObject,
  deleteObject,
  durableKey,
  thumbnailKeyFor,
} from "./storage";

/**
 * The completion pipeline.
 *
 * ── The tension this resolves ─────────────────────────────────────────────
 * "The bytes never transit Express" and "strip EXIF before storing" cannot both
 * be true of the same moment: stripping metadata means rewriting the file, and
 * rewriting it means having it. What can be true is that the *upload* does not
 * transit Express — the client's slow, connection-bound PUT goes straight to
 * the object store — and the server then reads the object once, from inside the
 * same datacentre, at wire speed.
 *
 * So the sequence is: presign into quarantine, client uploads, server fetches
 * and validates, server writes a clean copy to the durable prefix, quarantine
 * object is deleted. The document is not servable at any point before that
 * finishes, which is what `status` on the row is for.
 *
 * Nothing here trusts anything the client said. Not the size, not the MIME
 * type, not the filename.
 */

export type ProcessResult =
  | {
      ok: true;
      storageKey: string;
      thumbnailKey: string | null;
      mimeType: string;
      sizeBytes: number;
      checksum: string;
      width: number | null;
      height: number | null;
      strippedMetadata: boolean;
    }
  | { ok: false; reason: string; code: string };

/** Longest edge of a generated thumbnail. Enough for a list row on a 3x display. */
const THUMBNAIL_MAX_EDGE = 400;

/**
 * Re-encode quality for the formats that must be transcoded.
 *
 * High, and with chroma subsampling disabled. These are documents whose value
 * is that small print stays readable — an MRZ line, a bank balance, a reference
 * number. 4:2:0 subsampling is where text picks up colour fringing first, and
 * an unreadable passport scan gets the application rejected.
 */
const TRANSCODE_OPTIONS = { quality: 92, chromaSubsampling: "4:4:4" as const };

async function generateThumbnail(buf: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buf)
      // Honour the EXIF orientation flag before it is discarded, otherwise a
      // photo taken in portrait shows up sideways in the list.
      .rotate()
      .resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    // A thumbnail is an optimisation. Failing to make one must not fail the
    // upload of a document the user needs.
    return null;
  }
}

async function dimensionsOf(buf: Buffer): Promise<{ width: number | null; height: number | null }> {
  try {
    const meta = await sharp(buf).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

/**
 * Validate, clean and promote one uploaded object.
 *
 * On any failure the quarantine object is deleted before returning. Leaving
 * unvalidated bytes in the bucket after rejecting them is how a rejected upload
 * becomes stored data nobody knows about.
 */
export async function processUpload(opts: {
  quarantineKey: string;
  userId: string;
  purpose: string;
  originalFilename?: string;
}): Promise<ProcessResult> {
  const fail = async (code: string, reason: string): Promise<ProcessResult> => {
    await deleteObject(opts.quarantineKey);
    return { ok: false, code, reason };
  };

  const head = await headObject(opts.quarantineKey);
  if (!head) {
    // No object at the key. Either the client never completed the PUT, or it is
    // calling this endpoint speculatively.
    return { ok: false, code: "upload/not-found", reason: "No uploaded file was found." };
  }

  if (head.size === 0) {
    return fail("upload/empty", "That file was empty.");
  }
  if (head.size > MAX_UPLOAD_BYTES) {
    return fail(
      "upload/too-large",
      `That file is ${formatBytes(head.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
    );
  }

  const raw = await getObject(opts.quarantineKey, MAX_UPLOAD_BYTES);
  if (!raw) {
    return fail("upload/unreadable", "We could not read that file.");
  }

  // The only statement about the file's type that is worth anything.
  const detected = sniffFileType(raw);
  if (!detected) {
    return fail(
      "upload/unsupported-type",
      "That file type is not supported. Upload a JPEG, PNG, WEBP, HEIC or PDF.",
    );
  }

  let finalBuffer = raw;
  let finalType: DetectedType = detected;
  let strippedMetadata = false;

  const strip = stripMetadata(raw, detected);

  if (strip.needsTranscode) {
    // HEIC and WEBP: no lossless strip available, so re-encode to JPEG. The
    // quality cost is accepted here specifically because an unstripped HEIC
    // straight off a phone is the GPS-coordinates-on-a-passport-photo case.
    try {
      finalBuffer = await sharp(raw).rotate().jpeg(TRANSCODE_OPTIONS).toBuffer();
      finalType = "image/jpeg";
      strippedMetadata = true;
    } catch {
      return fail("upload/unreadable", "We could not process that image. Try a JPEG or PNG.");
    }
  } else if (strip.stripped) {
    finalBuffer = strip.buffer;
    strippedMetadata = true;
  }

  // Post-condition, not a second attempt. If an EXIF marker survives here the
  // stripper did not do what it claims, and storing the file anyway would mean
  // storing location data we told the user we removed.
  if (finalType !== "application/pdf" && containsExif(finalBuffer)) {
    return fail(
      "upload/metadata-not-removed",
      "We could not safely remove the location data from that image. Try exporting it as a JPEG first.",
    );
  }

  const isImage = finalType !== "application/pdf";

  const thumbnail = isImage ? await generateThumbnail(finalBuffer) : null;
  const { width, height } = isImage
    ? await dimensionsOf(finalBuffer)
    : { width: null, height: null };

  const key = durableKey(opts.userId, opts.purpose, extensionFor(finalType));
  const thumbKey = thumbnail ? thumbnailKeyFor(key) : null;

  try {
    await putObject(key, finalBuffer, finalType);
    if (thumbnail && thumbKey) await putObject(thumbKey, thumbnail, "image/jpeg");
  } catch (err) {
    console.error("[uploads] failed to write durable object:", (err as Error).message);
    return fail("upload/store-failed", "We could not save that file. Please try again.");
  }

  // The clean copy is stored; the unvalidated one has no further purpose.
  await deleteObject(opts.quarantineKey);

  return {
    ok: true,
    storageKey: key,
    thumbnailKey: thumbKey,
    mimeType: finalType,
    sizeBytes: finalBuffer.length,
    checksum: crypto.createHash("sha256").update(finalBuffer).digest("hex"),
    width,
    height,
    strippedMetadata,
  };
}
