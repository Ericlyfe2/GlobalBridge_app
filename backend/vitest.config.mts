import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Route-handler tests boot the Express app; give module init room on cold CI.
    testTimeout: 20_000,
  },
  resolve: {
    // fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..."
    // and the alias silently never matches.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
