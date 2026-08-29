import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/**
 * The live-verification harness.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Every other suite in this repo runs with Postgres mocked, which proves the
 * handlers' logic and proves nothing about the SQL. A mocked `query()` accepts
 * a statement with a typo in a column name, a window function the planner would
 * reject, and a timezone conversion that silently does the opposite of what was
 * intended — all of it green.
 *
 * This suite runs the real statements against a real PostgreSQL 16, started
 * in-process. It is the standard the rest of the project has been measured
 * against and repeatedly failed to meet: the bugs that mattered here were found
 * by exercising real endpoints against a real database, not by unit tests over
 * isolated logic.
 *
 * ── The port is fixed on purpose ──────────────────────────────────────────
 * Vitest runs globalSetup in a different process from the tests, and process.env
 * mutations do not reliably cross that boundary. A constant both sides import
 * is simpler and less fragile than plumbing the URL through vitest's provide/
 * inject machinery.
 */

export const LIVE_PG_PORT = 54330;
export const LIVE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${LIVE_PG_PORT}/postgres`;

export const DATA_DIR = path.join(os.tmpdir(), "globalbridge-live-pg");

/**
 * Migrations applied by the live harness.
 *
 * `0004_ai_surface` is excluded, and this is a real limitation rather than a
 * convenience: it requires the `pgvector` extension, which is a compiled
 * extension that the embedded PostgreSQL build does not ship. Nothing else
 * depends on it — only the AI surface uses those tables — so excluding it
 * verifies strictly more than refusing to run at all would.
 *
 * What that costs: the AI schema and every RAG query remain unverified against
 * a real database. That is recorded in the architecture notes rather than
 * quietly skipped here.
 */
export const EXCLUDED_MIGRATIONS = ["0004_ai_surface.sql"];

export const MIGRATIONS_SOURCE = path.resolve(__dirname, "../../../../db/migrations");

/**
 * Copy the migrations we can run into a temp directory.
 *
 * node-pg-migrate is pointed at this directory rather than the real one, so the
 * real files are executed byte-for-byte by the real tool — only the *set* is
 * narrowed. Rewriting or patching the SQL would mean verifying something other
 * than what ships.
 */
export function stageMigrations(): { dir: string; applied: string[]; excluded: string[] } {
  const dir = path.join(os.tmpdir(), "globalbridge-live-migrations");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const all = fs
    .readdirSync(MIGRATIONS_SOURCE)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  for (const file of all) {
    if (EXCLUDED_MIGRATIONS.includes(file)) continue;
    fs.copyFileSync(path.join(MIGRATIONS_SOURCE, file), path.join(dir, file));
    applied.push(file);
  }

  return { dir, applied, excluded: [...EXCLUDED_MIGRATIONS] };
}
