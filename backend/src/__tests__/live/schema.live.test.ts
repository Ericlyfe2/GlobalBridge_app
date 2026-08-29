import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import { LIVE_DATABASE_URL, MIGRATIONS_SOURCE, EXCLUDED_MIGRATIONS } from "./harness";

/**
 * Do the migrations actually produce the schema the code assumes?
 *
 * The mocked suites cannot answer this. A handler that selects a column which
 * no migration creates passes every one of them.
 */

let pool: Pool;

beforeAll(() => {
  pool = new Pool({ connectionString: LIVE_DATABASE_URL, max: 4 });
});

afterAll(async () => {
  await pool.end();
});

async function columnsOf(table: string): Promise<Set<string>> {
  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(rows.map((r) => r.column_name));
}

describe("migrations", () => {
  it("applied cleanly against a real PostgreSQL 16", async () => {
    const { rows } = await pool.query<{ version: string }>("SELECT version()");
    expect(rows[0].version).toMatch(/PostgreSQL 16\./);
  });

  it("recorded every staged migration in the ledger", async () => {
    const { rows } = await pool.query<{ name: string }>(
      "SELECT name FROM pgmigrations ORDER BY id",
    );
    const applied = rows.map((r) => r.name);

    const expected = fs
      .readdirSync(MIGRATIONS_SOURCE)
      .filter((f) => f.endsWith(".sql") && !EXCLUDED_MIGRATIONS.includes(f))
      .map((f) => path.basename(f, ".sql"))
      .sort();

    expect(applied.sort()).toEqual(expected);
  });

  it("is idempotent statement-by-statement, not just via the ledger", async () => {
    // 0001 is a reconciliation against a shared live database and every
    // statement in it claims to be idempotent. Re-running the file directly,
    // bypassing node-pg-migrate's ledger, is the only way to test that claim --
    // the ledger would otherwise skip it and prove nothing.
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_SOURCE, "0001_baseline_reconciliation.sql"),
      "utf8",
    );
    const up = sql.split("-- Down Migration")[0].replace("-- Up Migration", "");

    await expect(pool.query(up)).resolves.toBeDefined();
  });

  it("re-runs the uploads migration without error", async () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_SOURCE, "0006_uploads.sql"), "utf8");
    const up = sql.split("-- Down Migration")[0].replace("-- Up Migration", "");
    await expect(pool.query(up)).resolves.toBeDefined();
  });
});

describe("schema matches what the code selects", () => {
  it("users carries the columns the aggregates and reminders read", async () => {
    const columns = await columnsOf("users");
    for (const column of [
      "id",
      "firebase_uid",
      "email",
      "full_name",
      "role",
      "avatar_url",
      "country_of_origin",
      "country_of_residence",
      "preferred_language",
      "timezone",
      "verification_status",
      "profile_completed_at",
      "share_country_of_origin",
    ]) {
      expect(columns, column).toContain(column);
    }
  });

  it("mentor_bookings carries both timezone columns", async () => {
    const columns = await columnsOf("mentor_bookings");
    // student_timezone was a drift item applied by a one-off script and never
    // folded into the canonical schema; mentor_timezone did not exist at all.
    expect(columns).toContain("student_timezone");
    expect(columns).toContain("mentor_timezone");
  });

  it("notifications carries the mobile delivery columns", async () => {
    const columns = await columnsOf("notifications");
    for (const column of ["deep_link", "data", "collapse_key", "locale"]) {
      expect(columns, column).toContain(column);
    }
  });

  it("device_tokens exists with the uniqueness the register path relies on", async () => {
    const columns = await columnsOf("device_tokens");
    expect(columns).toContain("token");
    expect(columns).toContain("platform");

    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'device_tokens'`,
    );
    const defs = rows.map((r) => r.indexdef).join("\n");
    // The ON CONFLICT (user_id, token) upsert is a syntax error without this.
    expect(defs).toMatch(/UNIQUE INDEX.*\(user_id, token\)/);
  });

  it("user_documents carries the upload state machine", async () => {
    const columns = await columnsOf("user_documents");
    for (const column of [
      "storage_key",
      "thumbnail_key",
      "purpose",
      "status",
      "size_bytes",
      "checksum_sha256",
      "original_filename",
      "processed_at",
      "rejected_reason",
    ]) {
      expect(columns, column).toContain(column);
    }
  });

  it("made user_documents.url nullable for the pre-signed flow", async () => {
    const { rows } = await pool.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'user_documents' AND column_name = 'url'`,
    );
    // A pre-signed upload has no URL at insert time. NOT NULL here would make
    // every presign fail.
    expect(rows[0].is_nullable).toBe("YES");
  });

  it("has the reminders idempotency table", async () => {
    const columns = await columnsOf("reminders_sent");
    expect(columns.size).toBeGreaterThan(0);
  });
});

describe("the ON CONFLICT targets the code depends on", () => {
  it("supports the device-token upsert", async () => {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (firebase_uid, email, full_name, role)
       VALUES ('live-upsert-uid', 'upsert@example.com', 'Upsert', 'student')
       ON CONFLICT (firebase_uid) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    );
    const userId = user.rows[0].id;

    const upsert = `
      INSERT INTO device_tokens (user_id, token, platform, app_version, locale)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, token)
      DO UPDATE SET platform = EXCLUDED.platform, last_seen_at = NOW()
      RETURNING id`;

    const first = await pool.query(upsert, [userId, "tok-live-1", "ios", "1.0.0", "en"]);
    const second = await pool.query(upsert, [userId, "tok-live-1", "android", "1.1.0", "en"]);

    // Same row updated, not a duplicate inserted.
    expect(second.rows[0].id).toBe(first.rows[0].id);

    const count = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM device_tokens WHERE user_id = $1`,
      [userId],
    );
    expect(Number(count.rows[0].n)).toBe(1);
  });

  it("supports the saved-items uniqueness constraint", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'saved_items'`,
    );
    expect(rows.map((r) => r.indexdef).join("\n")).toMatch(
      /UNIQUE.*\(user_id, item_type, item_id\)/,
    );
  });
});
