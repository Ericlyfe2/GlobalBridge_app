import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Live verification.
 *
 * Separate from the default config because it boots a real PostgreSQL and takes
 * tens of seconds — the fast suite has to stay fast, and this one has to be
 * runnable on demand rather than on every save.
 *
 * Single-forked and non-parallel: every test shares one database, and the
 * fixtures are written to be readable rather than isolated by transaction.
 */
export default defineConfig({
  root: here,
  test: {
    environment: "node",
    include: ["src/__tests__/live/*.live.test.ts"],
    globalSetup: ["src/__tests__/live/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    pool: "forks",
    // Vitest 4 moved these to the top level of `test`.
    maxForks: 1,
    minForks: 1,
    fileParallelism: false,
  },
  resolve: { alias: { "@": path.resolve(here, "src") } },
});
