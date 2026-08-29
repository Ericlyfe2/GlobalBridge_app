import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { LIVE_PG_PORT, LIVE_DATABASE_URL, DATA_DIR, stageMigrations } from "./harness";

/**
 * Loaded through require rather than imported.
 *
 * The package's types only resolve under node16/nodenext module resolution,
 * which this project does not use for its own good reasons. A structural type
 * for the three methods actually called is a smaller price than changing the
 * resolution mode of the whole service to satisfy a test dependency.
 */
type EmbeddedPg = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPgCtor = new (options: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
}) => EmbeddedPg;

const requireCjs = createRequire(__filename);
const loaded = requireCjs("embedded-postgres") as { default?: EmbeddedPgCtor } & EmbeddedPgCtor;
const EmbeddedPostgres: EmbeddedPgCtor = loaded.default ?? loaded;

let pg: EmbeddedPg | null = null;

/**
 * The tool's JS entry point.
 *
 * Its exports map does not expose `bin/`, so `require.resolve` cannot find it,
 * and workspace hoisting can put the package in either node_modules.
 */
function resolveMigrateBinary(): string {
  const candidates = [
    path.resolve(__dirname, "../../../node_modules/node-pg-migrate/bin/node-pg-migrate.js"),
    path.resolve(__dirname, "../../../../node_modules/node-pg-migrate/bin/node-pg-migrate.js"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("node-pg-migrate not found. Looked in: " + candidates.join(" | "));
  }
  return found;
}

/**
 * Boot a real PostgreSQL, apply the real migrations with the real tool, and
 * leave it running for the suite.
 */
export async function setup(): Promise<void> {
  // A leftover data directory from an interrupted run will refuse to start.
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: LIVE_PG_PORT,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();

  const { dir, applied, excluded } = stageMigrations();
  const binary = resolveMigrateBinary();

  // Run the entry point with this Node directly rather than the .bin shim
  // through a shell. The shim is a .cmd on Windows, and `shell: true` re-splits
  // the path on spaces, which every path under this user's home directory has.
  const run = (): string =>
    execFileSync(
      process.execPath,
      [binary, "--migrations-dir", dir, "--migration-file-language", "sql", "up"],
      {
        env: { ...process.env, DATABASE_URL: LIVE_DATABASE_URL },
        encoding: "utf8",
        stdio: "pipe",
      },
    )
      .toString()
      .trim();

  const first = run();

  /**
   * Applied twice on purpose.
   *
   * The second run is a no-op through node-pg-migrate's own ledger, which
   * confirms the ledger works. Statement-level idempotence — the claim that
   * matters, because 0001 is a reconciliation against a shared live database —
   * is checked separately in schema.live.test.ts by re-running the file itself.
   */
  const second = run();

  const lastLine = (output: string) => output.split("\n").filter(Boolean).pop() ?? "(no output)";

  console.log(
    [
      "",
      "live Postgres on port " + LIVE_PG_PORT,
      "  migrations applied: " + applied.join(", "),
      "  excluded (needs pgvector): " + (excluded.join(", ") || "none"),
      "  first run:  " + lastLine(first),
      "  second run: " + lastLine(second),
      "",
    ].join("\n"),
  );
}

export async function teardown(): Promise<void> {
  if (pg) {
    await pg.stop();
    pg = null;
  }
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}
