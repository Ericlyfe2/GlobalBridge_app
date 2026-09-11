#!/usr/bin/env node
/**
 * Generates the app icon and Android adaptive-icon foreground from inline
 * SVG, using the same bridge glyph as AnimatedSplash.tsx and Icon.tsx's
 * `journey` icon -- the product's one recurring visual mark, not a generic
 * placeholder.
 */
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(__dirname, "../assets");
fs.mkdirSync(outDir, { recursive: true });

const BG = "#0A1628";
const GLOW = "#0d9488";
const CABLE = "#5eead4";
const DECK = "#14b8a6";
const TOWER = "#2dd4bf";

// Full icon: dark navy background, glow, bridge glyph. Used as the flat
// app icon (and as the source for the adaptive icon's background+foreground
// composited together for older/other launchers).
const iconSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="42%" r="55%">
      <stop offset="0%" stop-color="${GLOW}" stop-opacity="0.55"/>
      <stop offset="45%" stop-color="${GLOW}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${BG}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="${BG}"/>
  <circle cx="512" cy="430" r="420" fill="url(#glow)"/>
  <g transform="translate(512 520)">
    <path d="M-260 90 L-260 -100" stroke="${TOWER}" stroke-width="34" stroke-linecap="round"/>
    <path d="M260 90 L260 -100" stroke="${TOWER}" stroke-width="34" stroke-linecap="round"/>
    <path d="M-330 30 Q-260 -160 -140 -70 Q0 -170 140 -70 Q260 -160 330 30" stroke="${CABLE}" stroke-width="18" stroke-linecap="round" fill="none"/>
    <path d="M-330 90 L330 90" stroke="${DECK}" stroke-width="28" stroke-linecap="round"/>
    <g stroke="#0d9488" stroke-width="10" stroke-linecap="round" opacity="0.9">
      <path d="M-190 -10 L-190 90"/>
      <path d="M-70 -80 L-70 90"/>
      <path d="M70 -80 L70 90"/>
      <path d="M190 -10 L190 90"/>
    </g>
  </g>
</svg>`;

// Adaptive-icon foreground: transparent background, glyph only, kept inside
// the ~66dp safe-zone circle (Android crops the outer ring on some launchers).
const foregroundSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(512 545) scale(0.72)">
    <path d="M-260 90 L-260 -100" stroke="${TOWER}" stroke-width="34" stroke-linecap="round"/>
    <path d="M260 90 L260 -100" stroke="${TOWER}" stroke-width="34" stroke-linecap="round"/>
    <path d="M-330 30 Q-260 -160 -140 -70 Q0 -170 140 -70 Q260 -160 330 30" stroke="${CABLE}" stroke-width="18" stroke-linecap="round" fill="none"/>
    <path d="M-330 90 L330 90" stroke="${DECK}" stroke-width="28" stroke-linecap="round"/>
    <g stroke="#0d9488" stroke-width="10" stroke-linecap="round" opacity="0.9">
      <path d="M-190 -10 L-190 90"/>
      <path d="M-70 -80 L-70 90"/>
      <path d="M70 -80 L70 90"/>
      <path d="M190 -10 L190 90"/>
    </g>
  </g>
</svg>`;

// Splash icon: same as the main icon.png -- used by expo-splash-screen for
// the native splash (distinct from AnimatedSplash.tsx's own JS animation
// that plays after).
const DENSITIES = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

// A round mask for `ic_launcher_round.webp` -- the existing project has no
// adaptive-icon XML (AndroidManifest.xml points straight at flat
// `@mipmap/ic_launcher[_round]`), so each density needs its own
// pre-flattened square and round PNGs/webp rather than a foreground +
// background layer pair.
function circleMaskSvg(size) {
  return `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`;
}

async function run() {
  await sharp(Buffer.from(iconSvg)).resize(1024, 1024).png().toFile(path.join(outDir, "icon.png"));
  await sharp(Buffer.from(foregroundSvg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(outDir, "adaptive-icon-foreground.png"));
  console.log("Generated icon.png and adaptive-icon-foreground.png");

  const resDir = path.resolve(__dirname, "../android/app/src/main/res");
  for (const [density, size] of Object.entries(DENSITIES)) {
    const dir = path.join(resDir, `mipmap-${density}`);
    fs.mkdirSync(dir, { recursive: true });

    const square = await sharp(Buffer.from(iconSvg)).resize(size, size).webp().toBuffer();
    fs.writeFileSync(path.join(dir, "ic_launcher.webp"), square);

    const round = await sharp(Buffer.from(iconSvg))
      .resize(size, size)
      .composite([{ input: Buffer.from(circleMaskSvg(size)), blend: "dest-in" }])
      .webp()
      .toBuffer();
    fs.writeFileSync(path.join(dir, "ic_launcher_round.webp"), round);
  }
  console.log("Generated per-density launcher icons in android/app/src/main/res/mipmap-*");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
