/**
 * Token to cost conversion, and the per-user daily spend ceiling.
 *
 * Cost is derived from tokens on read rather than stored on the row. That keeps
 * ai_usage_log unchanged when prices move, and means a price correction
 * reprices history instead of leaving two eras of numbers in one table.
 *
 * Prices are USD per million tokens, matching how providers quote them.
 */

export type Price = { input: number; output: number };

export const MODEL_PRICING_USD_PER_MTOK: Record<string, Price> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "o4-mini": { input: 1.1, output: 4.4 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};

/**
 * Used when the configured model is not in the table above.
 *
 * Deliberately expensive. An unknown model must never be treated as free —
 * that turns "an admin switched to a model we have not priced yet" into an
 * unmetered spend hole, which is the exact failure the ceiling exists to stop.
 * Over-charging an unknown model only makes the ceiling arrive sooner, which is
 * the safe direction to be wrong in.
 */
export const FALLBACK_PRICE: Price = { input: 10, output: 30 };

export function priceFor(model: string | null | undefined): Price {
  if (!model) return FALLBACK_PRICE;
  return MODEL_PRICING_USD_PER_MTOK[model] ?? FALLBACK_PRICE;
}

export function costUsd(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = priceFor(model);
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

/**
 * Per-user, per-UTC-day ceiling in USD.
 *
 * A student doing heavy but genuine work — a long assistant session, a few
 * essay reviews, a handful of document checks — lands well under a dollar on
 * the mini-tier models this platform defaults to. Someone burning through
 * $1/day of inference is not using the product as intended.
 */
export const DAILY_CEILING_USD = (() => {
  const raw = Number(process.env.AI_DAILY_USD_CEILING);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
})();

/** UTC midnight — when the caller's budget resets. */
export function nextResetAt(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
}
