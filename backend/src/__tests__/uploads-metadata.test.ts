import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { stripMetadata, containsExif } from "../lib/uploads/metadata";
import { sniffFileType, extensionFor, MAX_UPLOAD_BYTES } from "../lib/uploads/file-type";

/**
 * The metadata stripper, tested against real encoded images rather than
 * hand-built byte fixtures — a stripper that passes on synthetic input and
 * corrupts an actual camera JPEG would be worse than none.
 */

/** A JPEG carrying EXIF, including GPS coordinates — the case that matters. */
async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: "#4477aa" } })
    .jpeg()
    .withExif({
      IFD0: { Make: "TestPhone", Model: "TestModel-12" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "5/1 33/1 0/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "0/1 12/1 0/1",
      },
    })
    .toBuffer();
}

async function pngWithText(): Promise<Buffer> {
  // sharp writes a tEXt/iTXt chunk for the comment plus a pHYs density chunk.
  return sharp({ create: { width: 64, height: 48, channels: 3, background: "#aa4477" } })
    .png()
    .withMetadata({ density: 300 })
    .toBuffer();
}

describe("file type sniffing", () => {
  it("identifies the formats it accepts from their bytes", async () => {
    expect(sniffFileType(await jpegWithGps())).toBe("image/jpeg");
    expect(sniffFileType(await pngWithText())).toBe("image/png");

    const webp = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#fff" },
    })
      .webp()
      .toBuffer();
    expect(sniffFileType(webp)).toBe("image/webp");

    expect(sniffFileType(Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"))).toBe("application/pdf");
  });

  it("ignores the extension and the declared type entirely", async () => {
    // A PNG named passport.jpg is still a PNG. The name never enters into it.
    const png = await pngWithText();
    expect(sniffFileType(png)).toBe("image/png");
  });

  it("rejects anything it cannot positively identify", () => {
    // An unrecognised file is not a file this product needs to accept;
    // "unknown" must never fall through to "probably fine".
    expect(sniffFileType(Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00"))).toBeNull();
    expect(sniffFileType(Buffer.from("<html><body>hello</body></html>"))).toBeNull();
    expect(sniffFileType(Buffer.from("#!/bin/sh\necho hi\n"))).toBeNull();
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
  });

  it("rejects SVG, which is a script container wearing an image extension", () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(sniffFileType(svg)).toBeNull();
  });

  it("recognises HEIC, which is what an iPhone camera produces", () => {
    // Rejecting this outright would break the most important mobile flow in
    // the product: photograph your passport page.
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypheic"),
      Buffer.alloc(16),
    ]);
    expect(sniffFileType(heic)).toBe("image/heic");
  });

  it("does not treat every ISO-BMFF file as an image", () => {
    // An MP4 shares the ftyp box structure but is not something we accept.
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypisom"),
      Buffer.alloc(16),
    ]);
    expect(sniffFileType(mp4)).toBeNull();
  });

  it("maps types to canonical extensions", () => {
    expect(extensionFor("image/jpeg")).toBe(".jpg");
    expect(extensionFor("application/pdf")).toBe(".pdf");
  });
});

describe("JPEG metadata stripping", () => {
  it("removes GPS coordinates from a photo", async () => {
    const original = await jpegWithGps();

    // Precondition: the fixture really does carry EXIF, or the test proves
    // nothing.
    expect(containsExif(original)).toBe(true);

    const result = stripMetadata(original, "image/jpeg");

    expect(result.stripped).toBe(true);
    expect(result.removedBytes).toBeGreaterThan(0);
    // A photograph of a passport page carries the user's full legal name and
    // their home coordinates in the same file. This assertion is the reason
    // this module exists.
    expect(containsExif(result.buffer)).toBe(false);
  });

  it("removes the camera make and model too", async () => {
    const result = stripMetadata(await jpegWithGps(), "image/jpeg");
    expect(result.buffer.includes(Buffer.from("TestPhone"))).toBe(false);
    expect(result.buffer.includes(Buffer.from("TestModel-12"))).toBe(false);
  });

  it("leaves the pixels bit-identical", async () => {
    // The whole reason for a container-level strip rather than a re-encode:
    // these are documents whose small print has to stay readable.
    const original = await jpegWithGps();
    const stripped = stripMetadata(original, "image/jpeg").buffer;

    const originalPixels = await sharp(original).raw().toBuffer();
    const strippedPixels = await sharp(stripped).raw().toBuffer();

    expect(strippedPixels.equals(originalPixels)).toBe(true);
  });

  it("produces a file decoders still accept", async () => {
    const stripped = stripMetadata(await jpegWithGps(), "image/jpeg").buffer;
    const meta = await sharp(stripped).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(48);
  });

  it("makes the file smaller, never larger", async () => {
    const original = await jpegWithGps();
    const stripped = stripMetadata(original, "image/jpeg").buffer;
    expect(stripped.length).toBeLessThan(original.length);
  });

  it("refuses to guess at a malformed JPEG", () => {
    // Returning the input untouched and flagging it lets the caller reject the
    // upload, rather than this function inventing a repair.
    const malformed = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from("not a jpeg at all")]);
    const result = stripMetadata(malformed, "image/jpeg");
    expect(result.stripped).toBe(false);
  });
});

describe("PNG metadata stripping", () => {
  it("removes metadata chunks and keeps the image decodable", async () => {
    const original = await pngWithText();
    const result = stripMetadata(original, "image/png");

    expect(result.stripped).toBe(true);

    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(64);
  });

  it("leaves the pixels bit-identical", async () => {
    const original = await pngWithText();
    const stripped = stripMetadata(original, "image/png").buffer;

    const before = await sharp(original).raw().toBuffer();
    const after = await sharp(stripped).raw().toBuffer();
    expect(after.equals(before)).toBe(true);
  });

  it("keeps the chunks the decoder needs", async () => {
    const stripped = stripMetadata(await pngWithText(), "image/png").buffer;
    expect(stripped.includes(Buffer.from("IHDR"))).toBe(true);
    expect(stripped.includes(Buffer.from("IDAT"))).toBe(true);
    expect(stripped.includes(Buffer.from("IEND"))).toBe(true);
  });
});

describe("formats that cannot be stripped losslessly", () => {
  it("flags HEIC for transcoding rather than storing it unstripped", () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypheic"),
      Buffer.alloc(64),
    ]);
    const result = stripMetadata(heic, "image/heic");
    // Saying "stripped" here would be a lie that ends with GPS coordinates in
    // the bucket.
    expect(result.stripped).toBe(false);
    expect(result.needsTranscode).toBe(true);
  });

  it("flags WEBP the same way", async () => {
    const webp = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#fff" },
    })
      .webp()
      .toBuffer();
    const result = stripMetadata(webp, "image/webp");
    expect(result.needsTranscode).toBe(true);
  });

  it("does not claim to strip a PDF", () => {
    const pdf = Buffer.from("%PDF-1.7\ntrailer\n");
    const result = stripMetadata(pdf, "application/pdf");
    expect(result.stripped).toBe(false);
    expect(result.needsTranscode).toBe(false);
  });
});

describe("limits", () => {
  it("accommodates a phone photo without inviting abuse", () => {
    // A modern camera produces 3-6 MB; a multi-page scan can double that.
    expect(MAX_UPLOAD_BYTES).toBeGreaterThanOrEqual(10 * 1024 * 1024);
    expect(MAX_UPLOAD_BYTES).toBeLessThanOrEqual(25 * 1024 * 1024);
  });
});
