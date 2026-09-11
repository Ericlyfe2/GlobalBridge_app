#!/usr/bin/env node
/**
 * Stand-in for `expo export:embed`, used only for the release Gradle task.
 *
 * `expo export:embed` has a real bug in this npm-workspaces monorepo: it
 * resolves the JS entry file relative to the workspace root instead of
 * mobile/, regardless of what absolute --entry-file path or `root` Gradle
 * config is given (confirmed by reproducing it directly, outside Gradle).
 * A plain `expo export:embed` run from mobile/ with the same absolute paths
 * works fine, so this copies that already-verified output into whatever
 * --bundle-output / --assets-dest Gradle's BundleHermesCTask asks for,
 * satisfying its real Provider/task-graph wiring (unlike `-x`, which skips
 * the task and breaks downstream tasks that depend on its output provider).
 *
 * Delete this and restore the real `expo/cli` bin as `cliFile` once the
 * upstream monorepo path-resolution bug is fixed.
 */
const fs = require("fs");
const path = require("path");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const bundleOutput = arg("--bundle-output");
const assetsDest = arg("--assets-dest");
const sourcemapOutput = arg("--sourcemap-output");

if (!bundleOutput || !assetsDest) {
  console.error("fake-bundle-cli: missing --bundle-output or --assets-dest");
  process.exit(1);
}

const prebuiltDir = path.resolve(__dirname, "../prebuilt-release");

fs.mkdirSync(path.dirname(bundleOutput), { recursive: true });
fs.copyFileSync(path.join(prebuiltDir, "index.android.bundle"), bundleOutput);

fs.mkdirSync(assetsDest, { recursive: true });
fs.cpSync(path.join(prebuiltDir, "assets"), assetsDest, { recursive: true });

// The Hermes compose-source-maps step reads this unconditionally even when
// no --sourcemap-output flag is passed, at a fixed path under build/. An
// empty-but-valid source map is enough -- this build's stack traces just
// won't be symbolicated, which is fine for a sideloaded test install.
const emptyMap = JSON.stringify({ version: 3, sources: [], names: [], mappings: "" });
const mapTargets = [
  sourcemapOutput,
  path.resolve(
    __dirname,
    "../android/app/build/intermediates/sourcemaps/react/release/index.android.bundle.packager.map",
  ),
].filter(Boolean);
for (const target of mapTargets) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, emptyMap);
}

console.log("fake-bundle-cli: copied prebuilt release bundle, assets, and a stub sourcemap");
