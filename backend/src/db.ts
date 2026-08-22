import { Pool } from "pg";
import Redis from "ioredis";

/**
 * Parameterised SQL only. There is no ORM and no query builder here on purpose:
 * every statement in this service is readable as the SQL that actually runs.
 * `query`/`queryOne` take `$1`-style placeholders — never build a statement by
 * interpolating a value into the string.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 25,
  min: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 12_000,
});

pool.on("error", (err) => console.error("Postgres pool error", err));

export const redis: Redis | null = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false })
  : null;

if (redis) {
  redis.on("error", (err) => console.error("Redis error", err));
} else if (process.env.NODE_ENV !== "test") {
  console.warn("⚠ REDIS_URL not set — single-instance WebSocket fan-out, per-process rate limits");
}

export async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

export async function queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Run a set of statements in one transaction, rolling back on any throw. */
export async function withTransaction<T>(fn: (q: typeof query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scoped = async <R>(sql: string, params: unknown[] = []): Promise<R[]> =>
      (await client.query(sql, params)).rows as R[];
    const result = await fn(scoped as typeof query);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
