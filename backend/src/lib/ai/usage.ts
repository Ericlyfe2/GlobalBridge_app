import { query } from "../../db";
import { costUsd, DAILY_CEILING_USD, nextResetAt } from "./pricing";

/**
 * The spend ledger.
 *
 * ai_usage_log is both the admin console's data source and the enforcement
 * point for the per-user daily ceiling. Those being the same table is
 * deliberate: an observability table nobody enforces against drifts out of
 * date, and an enforcement counter nobody can see is impossible to debug when
 * a user says they were cut off unfairly.
 */

export type UsageRecord = {
  userId: string;
  feature: string;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheHit?: boolean;
  responseTimeMs?: number;
  error?: string | null;
};

/**
 * Book one completed (or failed) call.
 *
 * Never throws. A bookkeeping failure must not turn a successful answer into
 * an error for the user — the cost of a missed row is that one call goes
 * unbilled against the ceiling, which is strictly better than failing a
 * request the model already answered and we already paid for.
 */
export async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    await query(
      `INSERT INTO ai_usage_log
         (user_id, feature, model, input_tokens, output_tokens, cache_hit, response_time_ms, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.userId,
        record.feature,
        record.model ?? null,
        record.inputTokens ?? 0,
        record.outputTokens ?? 0,
        record.cacheHit ?? false,
        record.responseTimeMs ?? null,
        record.error ?? null,
      ],
    );
  } catch (err) {
    console.error("recordUsage failed:", (err as Error).message);
  }
}

export type Quota = {
  spent_usd: number;
  limit_usd: number;
  exceeded: boolean;
  calls: number;
  resets_at: string;
};

/**
 * Today's spend for one user.
 *
 * Grouped by model because each model has its own price — summing tokens
 * across models first and pricing the total would apply one model's price to
 * another's tokens, which is wrong in whichever direction the cheaper model
 * dominates.
 */
export async function todayQuota(userId: string): Promise<Quota> {
  const rows = await query<{
    model: string | null;
    in_tok: string;
    out_tok: string;
    calls: string;
  }>(
    `SELECT model,
            COALESCE(SUM(input_tokens), 0)::text  AS in_tok,
            COALESCE(SUM(output_tokens), 0)::text AS out_tok,
            COUNT(*)::text                        AS calls
       FROM ai_usage_log
      WHERE user_id = $1
        AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'utc')
      GROUP BY model`,
    [userId],
  );

  let spent = 0;
  let calls = 0;
  for (const r of rows) {
    spent += costUsd(r.model, Number(r.in_tok), Number(r.out_tok));
    calls += Number(r.calls);
  }

  const spentUsd = Math.round(spent * 1e6) / 1e6;

  return {
    spent_usd: spentUsd,
    limit_usd: DAILY_CEILING_USD,
    exceeded: spentUsd >= DAILY_CEILING_USD,
    calls,
    resets_at: nextResetAt(),
  };
}
