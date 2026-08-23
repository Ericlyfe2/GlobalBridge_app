import type { Request, Response, NextFunction } from "express";
import { withQueryStats } from "../lib/query-stats";
import { env } from "../env";

/**
 * Development-only per-request query logging.
 *
 * Off in production, and not merely quiet there: the statements array holds SQL
 * text, and the point of the counter is feedback while writing code, not a
 * production telemetry channel.
 *
 * The threshold matters more than the log line. Most endpoints here run one or
 * two statements; the aggregates run a fixed handful in parallel. Anything past
 * QUERY_WARN_THRESHOLD is either a loop over the database or an endpoint that
 * has grown past what a single round trip should do, and both deserve to be
 * shouted about while they are still cheap to fix.
 */

/** Above this, the line is a warning rather than a note. */
const QUERY_WARN_THRESHOLD = 12;

export function queryLogger(req: Request, res: Response, next: NextFunction) {
  if (env.NODE_ENV !== "development") return next();

  void withQueryStats(
    () =>
      new Promise<void>((resolve) => {
        res.on("finish", resolve);
        res.on("close", resolve);
        next();
      }),
  ).then(({ stats }) => {
    if (stats.count === 0) return;

    const line =
      `${req.method} ${req.path} — ${stats.count} ${stats.count === 1 ? "query" : "queries"}, ` +
      `${stats.totalMs}ms in the driver`;

    if (stats.count > QUERY_WARN_THRESHOLD) {
      console.warn(`⚠ ${line} — looks like an N+1`);
      for (const sql of stats.statements) console.warn(`    ${sql}`);
    } else {
      console.log(`   ${line}`);
    }
  });
}
