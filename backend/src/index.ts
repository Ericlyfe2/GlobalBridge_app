import "dotenv/config";
import { env } from "./env";
import { createApp } from "./app";
import { initWebsocket } from "./ws";
import { startScheduler, stopScheduler } from "./scheduler";
import { pool } from "./db";

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled rejection:", reason);
});

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`🌍 GlobalBridge mobile API on http://localhost:${env.PORT}`);
  console.log(`   min supported client: ${env.MIN_SUPPORTED_APP_VERSION}`);
});

initWebsocket(server);
startScheduler();

/**
 * Graceful shutdown. A deploy that drops in-flight requests shows up on a phone
 * as a failed save, and the offline queue will replay it -- which is only
 * harmless because mutations carry idempotency keys.
 */
async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  // Stop taking new passes before closing the pool a running one is using.
  stopScheduler();
  server.close(async () => {
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
  // Do not hang forever on a socket that will not close.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
