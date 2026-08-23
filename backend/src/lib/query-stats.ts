import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request query counting.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The aggregate endpoints are the two places in this service where an N+1 is
 * both easy to write and expensive to have: `/home` is the first call after
 * every cold start, and `/sync` runs on every foreground. An N+1 there does not
 * announce itself — the response is correct, the tests pass, and the only
 * symptom is that the home screen takes two seconds instead of two hundred
 * milliseconds on a connection where that difference is the whole experience.
 *
 * A counter that prints "7 queries" next to every request turns "did I just
 * write a loop over the database" into something you notice while writing it,
 * rather than something a profiler finds later.
 *
 * AsyncLocalStorage rather than passing a context object down: `query()` is
 * called from library code several layers below the handler, and threading a
 * counter through every signature to instrument it would be a worse trade than
 * the small cost of async context tracking.
 */

export type QueryStats = {
  count: number;
  /** Total time inside the driver, which is not the same as request time. */
  totalMs: number;
  /** Statements seen, first 80 chars. Dev only — SQL text is not logged in production. */
  statements: string[];
};

const storage = new AsyncLocalStorage<QueryStats>();

/**
 * Run `fn` with a fresh counter. Returns whatever the counter ended up holding.
 */
export function withQueryStats<T>(fn: () => Promise<T>): Promise<{ result: T; stats: QueryStats }> {
  const stats: QueryStats = { count: 0, totalMs: 0, statements: [] };
  return storage.run(stats, async () => ({ result: await fn(), stats }));
}

/** Called by db.query. A no-op outside a counted scope, which is most of the time. */
export function recordQuery(sql: string, durationMs: number): void {
  const stats = storage.getStore();
  if (!stats) return;

  stats.count += 1;
  stats.totalMs += durationMs;

  // Capped so a request that genuinely issues hundreds of statements does not
  // accumulate a large array in memory just to describe how bad it is.
  if (stats.statements.length < 50) {
    stats.statements.push(sql.replace(/\s+/g, " ").trim().slice(0, 80));
  }
}

/** The current request's stats, if it is being counted. */
export function currentQueryStats(): QueryStats | undefined {
  return storage.getStore();
}
