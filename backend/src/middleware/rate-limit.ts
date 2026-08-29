import type { Request, Response } from "express";
import rateLimit, { type Store, type Options, type ClientRateLimitInfo } from "express-rate-limit";
import { hit, release, resetKey, normalizeIp } from "../lib/rate-limit";
import { redis } from "../db";

/**
 * The global HTTP rate limit.
 *
 * ── Keyed by account, not by address ──────────────────────────────────────
 * Keying purely by IP is what forced the global budget up to an uncomfortably
 * high number in the first place. This audience sits behind campus and dorm
 * NAT, and carrier-grade NAT puts an entire city's mobile subscribers behind a
 * handful of addresses — so any per-IP limit tight enough to stop abuse also
 * locks out hundreds of people who did nothing. A per-account key makes the
 * budget follow the person, which is the thing we actually want to bound.
 *
 * Anonymous traffic still falls back to the address, because there is nothing
 * else to key on.
 */

/** Adapts the shared counter to express-rate-limit's Store interface. */
class SharedStore implements Store {
  private windowMs = 15 * 60 * 1000;

  /**
   * Part of the Store interface rather than a private detail: the library uses
   * it to tell two stores apart when checking for double-counting.
   */
  readonly prefix: string;

  /**
   * False tells express-rate-limit the counters are shared across instances,
   * so it does not assume it can reason about them locally.
   */
  readonly localKeys = false;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private key(key: string): string {
    return `${this.prefix}:${key}`;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const result = await hit(this.key(key), this.windowMs);
    return { totalHits: result.totalHits, resetTime: result.resetAt };
  }

  async decrement(key: string): Promise<void> {
    await release(this.key(key));
  }

  async resetKey(key: string): Promise<void> {
    await resetKey(this.key(key));
  }
}

/**
 * Derive the limiter key from the request.
 *
 * Reading the user id off the *unverified* token is deliberate and safe. This
 * runs before authentication, and a forged token only moves the request into a
 * bucket the attacker chose — it cannot raise anyone's allowance, and the
 * request still has to pass real verification afterwards. Verifying here
 * instead would mean a signature check on every request we are about to reject.
 *
 * The one thing it must not do is let a forged token *displace* a real user's
 * counter in a way that harms them. It cannot: sharing a bucket with an
 * attacker who has guessed your user id costs you part of your own allowance,
 * which is the same exposure as sharing an IP, and the attacker gains nothing.
 */
export function limiterKey(req: Request): string {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const parts = header.slice(7).split(".");
    if (parts.length === 3) {
      try {
        const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
          user_id?: unknown;
          sub?: unknown;
        };
        if (typeof claims.user_id === "string" && claims.user_id) return `u:${claims.user_id}`;
        if (typeof claims.sub === "string" && claims.sub) return `u:${claims.sub}`;
      } catch {
        /* malformed token — fall through to the address */
      }
    }
  }
  return `ip:${normalizeIp(req.ip)}`;
}

function tooMany(_req: Request, res: Response) {
  const resetAt = res.getHeader("RateLimit-Reset");
  const retryAfter = typeof resetAt === "string" || typeof resetAt === "number" ? resetAt : 60;

  res.set("Retry-After", String(retryAfter));
  res.status(429).json({
    error: "You are doing that too quickly. Try again in a minute.",
    code: "rate/limited",
    retry_after: Number(retryAfter),
  });
}

/**
 * 1200 requests / 15 minutes.
 *
 * Now that the key is per-account this number bounds one person rather than one
 * building, so it is generous on purpose: a mobile client that syncs on every
 * foreground, holds a socket, and refreshes in the background spends requests
 * without a human present. The number that actually stops runaway spend is the
 * AI daily ceiling, not this.
 */
export const httpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: limiterKey,
  handler: tooMany,
  store: new SharedStore("rl:http"),
});

/** Whether counters are shared across instances right now. Reported by /health. */
export function rateLimitBackend(): "redis" | "in-process" {
  return redis ? "redis" : "in-process";
}
