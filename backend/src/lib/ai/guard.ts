import type { Request, Response, NextFunction } from "express";
import { todayQuota } from "./usage";

/**
 * The gate every AI endpoint passes through: burst limit, then spend ceiling.
 *
 * ── What the port removed ─────────────────────────────────────────────────
 * Previously each of these steps was an HTTP round trip from one runtime to
 * another: verify the token by calling `GET /auth/me`, then fetch the quota by
 * calling `GET /ai/usage/today`, then write the ledger row by calling
 * `POST /ai/usage`. Three network calls, each with a timeout to choose and a
 * failure mode to decide on, to do work the API already had in-process.
 *
 * Here authentication is `requireAuth` in the middleware chain, and the quota
 * is one query. That is the whole argument for Option A in one function.
 *
 * ── Ordering ──────────────────────────────────────────────────────────────
 * Burst limit first because it is free; the ceiling costs a query. Both run
 * before the model is called, so an over-budget request costs nothing.
 */

type Bucket = { count: number; resetAt: number };

/**
 * Per-feature, per-user burst counters.
 *
 * In-process, and therefore per-instance: with N instances a user gets N times
 * the burst allowance. That is acceptable for a burst limit whose job is to
 * stop a runaway client loop, precisely because the *spend* ceiling below it is
 * backed by the database and is not per-instance. The cheap check being
 * approximate is fine when the authoritative one is not.
 */
const buckets = new Map<string, Bucket>();

/** Bound the map: an unbounded key space keyed on user id is a slow leak. */
const MAX_BUCKETS = 50_000;

function hitLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

/** Test seam. */
export function clearAiRateLimits(): void {
  buckets.clear();
}

export type AiFeature =
  | "chat"
  | "scam-check"
  | "doc-check"
  | "visa-roadmap"
  | "readiness"
  | "score-essay"
  | "compare-countries"
  | "translate";

/**
 * Per-minute burst allowances, carried over from the previous implementation.
 *
 * translate is high because a single screen render batches many strings into
 * one call and a language switch can fire several; the strict-JSON analysis
 * features are low because each one is a large, slow, expensive completion that
 * no human triggers ten times a minute.
 */
const BURST_LIMITS: Record<AiFeature, number> = {
  chat: 20,
  translate: 60,
  "compare-countries": 15,
  "scam-check": 10,
  "doc-check": 10,
  "score-essay": 10,
  "visa-roadmap": 8,
  readiness: 8,
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      aiFeature?: AiFeature;
    }
  }
}

export function aiGuard(feature: AiFeature) {
  const limit = BURST_LIMITS[feature];

  return async (req: Request, res: Response, next: NextFunction) => {
    // requireAuth runs before this in the chain; this is a programming-error
    // guard, not an auth check.
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    req.aiFeature = feature;

    const burst = hitLimit(`${feature}:${req.user.sub}`, limit, 60_000);
    if (!burst.ok) {
      res.set("Retry-After", String(burst.retryAfter));
      return res.status(429).json({
        error: "You are using this tool very quickly. Give it a moment and try again.",
        code: "ai/rate-limited",
        retry_after: burst.retryAfter,
      });
    }

    try {
      const quota = await todayQuota(req.user.sub);
      if (quota.exceeded) {
        res.set("Retry-After", String(secondsUntil(quota.resets_at)));
        return res.status(429).json({
          error:
            "You have reached today's AI usage limit. It resets at midnight UTC — " +
            "meanwhile you can still browse opportunities, housing and the community.",
          code: "ai/daily-ceiling",
          resets_at: quota.resets_at,
        });
      }
    } catch (err) {
      // The ledger is unreachable. Allowing the call through is deliberate:
      // failing closed would take the entire AI surface offline over an
      // infrastructure blip unrelated to anyone's budget, and the burst limit
      // plus the per-feature input caps still bound the damage in that window.
      console.error("quota check failed, allowing request:", (err as Error).message);
    }

    next();
  };
}

function secondsUntil(iso: string): number {
  const s = Math.ceil((new Date(iso).getTime() - Date.now()) / 1000);
  return Number.isFinite(s) && s > 0 ? s : 60;
}

/**
 * Total characters across every user-supplied string in a payload.
 *
 * max_tokens caps only what the model writes back. Without an input cap a
 * single request can carry megabytes of prompt, which is the expensive half —
 * and the half an attacker controls.
 */
export function totalChars(...parts: (string | string[] | undefined | null)[]): number {
  let n = 0;
  for (const p of parts) {
    if (typeof p === "string") n += p.length;
    else if (Array.isArray(p)) for (const s of p) n += typeof s === "string" ? s.length : 0;
  }
  return n;
}

/** 413 naming the actual limit, so the user knows how much to cut. */
export function tooLarge(res: Response, limit: number) {
  return res.status(413).json({
    error: `That is too long to analyse — keep it under ${limit.toLocaleString()} characters.`,
    code: "ai/input-too-large",
    limit,
  });
}
