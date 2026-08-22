import type { DetectedType } from "./file-type";

/**
 * Metadata stripping.
 *
 * ── Why this matters more here than in most products ──────────────────────
 * A phone writes GPS coordinates into every photo it takes. A user
 * photographing their passport page is therefore uploading a file that says
 * exactly where they were standing — usually their home — attached to a
 * document carrying their full legal name, nationality and date of birth. For
 * an audience that includes asylum seekers and people with reason to avoid
 * being located, that pairing is the single most dangerous thing this product
 * could store carelessly.
 *
 * EXIF also carries device serial numbers, the original capture timestamp, and
 * on some phones a thumbnail of the *unedited* frame — so cropping out a
 * sensitive corner and re-uploading can leave the uncropped version embedded.
 *
 * ── Why strip losslessly rather than re-encode ────────────────────────────
 * The obvious implementation is to run the image through an encoder, which
 * drops metadata as a side effect. It also re-compresses it — and the whole
 * point of these files is that a human or a checker has to read small print on
 * them: a passport MRZ, a bank statement's figures, an acceptance letter's
 * reference number. Generational JPEG loss on text is exactly where artefacts
 * are most visible, and an unreadable document gets rejected by an embassy.
 *
 * So JPEG and PNG are stripped at the container level: the metadata segments
 * are dropped and the compressed image data is copied through byte for byte.
 * The pixels are bit-identical to what the user uploaded.
 *
 * Formats that cannot be handled that way are named in `stripMetadata`'s
 * return, so the caller can decide rather than being silently given an
 * unstripped file.
 */

export type StripResult = {
  buffer: Buffer;
  /** True when every metadata container we know of was removed. */
  stripped: boolean;
  /** Bytes removed, for logging. */
  removedBytes: number;
  /** Set when the format cannot be stripped losslessly and needs transcoding. */
  needsTranscode: boolean;
};

/**
 * JPEG: drop APPn segments.
 *
 * A JPEG is SOI, then a sequence of marker segments, then entropy-coded scan
 * data. EXIF lives in APP1, JFIF in APP0, Photoshop/IPTC in APP13, XMP in
 * another APP1. All of them are optional and none is referenced by the decoder,
 * so removing them yields a smaller file that decodes to identical pixels.
 *
 * Everything from the start-of-scan marker onward is copied verbatim — that is
 * the actual image, and it must not be touched.
 */
function stripJpeg(buf: Buffer): StripResult {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return { buffer: buf, stripped: false, removedBytes: 0, needsTranscode: false };
  }

  const out: Buffer[] = [buf.subarray(0, 2)]; // SOI
  let offset = 2;
  let removed = 0;

  while (offset < buf.length - 1) {
    if (buf[offset] !== 0xff) {
      // Not at a marker boundary — the file is malformed in a way we should not
      // try to repair. Hand it back untouched and let the caller reject it.
      return { buffer: buf, stripped: false, removedBytes: 0, needsTranscode: false };
    }

    const marker = buf[offset + 1];

    // Start of scan: the rest of the file is compressed image data.
    if (marker === 0xda) {
      out.push(buf.subarray(offset));
      break;
    }

    // Standalone markers carry no length field.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      out.push(buf.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    if (offset + 4 > buf.length) break;
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buf.length) {
      return { buffer: buf, stripped: false, removedBytes: 0, needsTranscode: false };
    }

    const isAppSegment = marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;

    if (isAppSegment || isComment) {
      removed += segmentLength + 2;
    } else {
      out.push(buf.subarray(offset, offset + 2 + segmentLength));
    }

    offset += 2 + segmentLength;
  }

  return {
    buffer: Buffer.concat(out),
    stripped: true,
    removedBytes: removed,
    needsTranscode: false,
  };
}

/** PNG chunks that carry metadata rather than image data. */
const PNG_METADATA_CHUNKS = new Set([
  "tEXt",
  "zTXt",
  "iTXt",
  "eXIf",
  "tIME",
  "pHYs",
  "iCCP",
]);

/**
 * PNG: drop metadata chunks.
 *
 * A PNG is an 8-byte signature followed by length-prefixed, CRC-checked chunks.
 * Dropping a non-critical ancillary chunk is well-defined by the spec and every
 * decoder handles it — the IDAT image data and the IHDR/PLTE it depends on are
 * copied through untouched, so the pixels are unchanged.
 */
function stripPng(buf: Buffer): StripResult {
  const SIGNATURE_LENGTH = 8;
  if (buf.length < SIGNATURE_LENGTH) {
    return { buffer: buf, stripped: false, removedBytes: 0, needsTranscode: false };
  }

  const out: Buffer[] = [buf.subarray(0, SIGNATURE_LENGTH)];
  let offset = SIGNATURE_LENGTH;
  let removed = 0;

  while (offset + 8 <= buf.length) {
    const dataLength = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const totalLength = 12 + dataLength; // length + type + data + CRC

    if (offset + totalLength > buf.length) break;

    if (PNG_METADATA_CHUNKS.has(type)) {
      removed += totalLength;
    } else {
      out.push(buf.subarray(offset, offset + totalLength));
    }

    offset += totalLength;
    if (type === "IEND") break;
  }

  return {
    buffer: Buffer.concat(out),
    stripped: true,
    removedBytes: removed,
    needsTranscode: false,
  };
}

/**
 * Strip what can be stripped, and say honestly when it cannot.
 *
 * HEIC and WEBP are ISO-BMFF and RIFF containers whose metadata boxes are
 * interleaved with image data in ways a naive rewrite gets wrong. Rather than
 * ship a half-correct parser for the format iPhones actually produce, those are
 * flagged `needsTranscode` and the caller re-encodes them — accepting the
 * quality cost for those two formats specifically, because an unstripped HEIC
 * from a phone camera is the exact GPS-in-a-passport-photo case this module
 * exists to prevent.
 *
 * PDF is not stripped at all. A PDF's metadata is spread across the document
 * catalogue, an XMP stream and per-object dictionaries, and rewriting it
 * safely means a full parser. PDFs are instead served as attachments and never
 * inline — see the storage layer.
 */
export function stripMetadata(buf: Buffer, type: DetectedType): StripResult {
  switch (type) {
    case "image/jpeg":
      return stripJpeg(buf);
    case "image/png":
      return stripPng(buf);
    case "image/heic":
    case "image/webp":
      return { buffer: buf, stripped: false, removedBytes: 0, needsTranscode: true };
    case "application/pdf":
      return { buffer: buf, stripped: false, removedBytes: 0, needsTranscode: false };
  }
}

/**
 * Does this buffer still contain an EXIF marker?
 *
 * Used as a post-condition check rather than as the strip itself: if this
 * returns true after stripping, something is wrong and the upload is rejected
 * rather than stored with location data in it.
 */
export function containsExif(buf: Buffer): boolean {
  // "Exif\0\0" — the EXIF identifier, wherever it appears.
  return buf.includes(Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]));
}
