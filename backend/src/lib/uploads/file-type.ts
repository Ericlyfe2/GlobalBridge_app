/**
 * Content type from the bytes themselves.
 *
 * The client's declared MIME and the filename extension are both attacker-
 * controlled and neither is ever trusted: a Windows executable, an HTML page or
 * a script-bearing SVG uploaded as "image/png" would otherwise be stored and
 * later served from our origin under that type.
 *
 * This is a small closed allow-list rather than a general sniffing library.
 * Anything not positively identified as one of these formats is rejected —
 * an unrecognised file is not a file this product needs to accept, and
 * "unknown" must never fall through to "probably fine".
 */

export type DetectedType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "application/pdf";

const startsWith = (buf: Buffer, sig: number[], offset = 0): boolean => {
  if (buf.length < offset + sig.length) return false;
  return sig.every((byte, i) => buf[offset + i] === byte);
};

const ascii = (buf: Buffer, text: string, offset = 0): boolean =>
  startsWith(buf, [...text].map((c) => c.charCodeAt(0)), offset);

/**
 * How many leading bytes are enough to identify every accepted format.
 *
 * Matters because the completion step can fetch just this prefix to reject a
 * bad upload before pulling down a multi-megabyte object.
 */
export const SNIFF_BYTES = 32;

/**
 * Note the absences.
 *
 * **SVG** is XML that can carry `<script>` — an executable document wearing an
 * image's extension. There is no product need for user-supplied SVG.
 *
 * **GIF** is accepted by the web platform but not here: nothing in the mobile
 * flows produces one, and every accepted format is a format we have to be able
 * to strip metadata from and thumbnail.
 */
export function sniffFileType(buf: Buffer): DetectedType | null {
  if (buf.length < 12) return null;

  // JPEG — FF D8 FF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";

  // PNG — 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";

  // WEBP — "RIFF" ???? "WEBP"
  if (ascii(buf, "RIFF") && ascii(buf, "WEBP", 8)) return "image/webp";

  // HEIC/HEIF — ISO-BMFF box: ???? "ftyp" then a brand.
  // This is what an iPhone camera produces by default, so rejecting it outright
  // would break the single most important mobile flow in the product
  // (photograph your passport page).
  if (ascii(buf, "ftyp", 4)) {
    const brand = buf.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(brand)) {
      return "image/heic";
    }
    return null;
  }

  // PDF — "%PDF-"
  if (ascii(buf, "%PDF-")) return "application/pdf";

  return null;
}

/** Canonical extension for a verified type. Never taken from the uploaded filename. */
export function extensionFor(type: DetectedType): string {
  switch (type) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/heic":
      return ".heic";
    case "application/pdf":
      return ".pdf";
  }
}

/**
 * Largest single upload.
 *
 * A modern phone camera produces 3-6 MB per photo and a multi-page scanned PDF
 * can reach twice that. 15 MB accommodates both without being an invitation.
 */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Total stored bytes one account may hold.
 *
 * Sized for the real job: a handful of identity and financial documents, a
 * profile photo, and photos for a listing or two. Without a quota the only
 * ceiling is the request rate limit, which at this file size is gigabytes per
 * window per account.
 */
export const PER_USER_QUOTA_BYTES = 100 * 1024 * 1024;

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}
