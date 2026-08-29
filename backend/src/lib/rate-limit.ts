import { redis } from "../db";

/**
 * The counter behind every rate limit in this service.
 *
 * ── Why it is Redis-backed, and why Redis stays optional ──────────────────
 * In-process counters are per-instance: with N instances a caller gets N times
 * the allowance, and the limit silently means something different after every
 * scale-up. That is fine for a burst guard and not fine for anything that is
 * actually load-bearing, so the counter lives in Redis when Redis is there.
 *
 * When it is not — local development, a single-instance deploy — the same
 * function falls back to a per-process map with identical semantics. The server
 * must boot and behave sensibly with no `REDIS_URL`, which is a standing
 * constraint in this codebase, so "Redis or nothing" was never an option.
 *
 * ── Fixed window, not a sliding one ───────────────────────────────────────
 * A fixed window lets a caller send `limit` requests at the end of one window
 * and `limit` more at the start of the next — a 2x burst across the boundary.
 * A sliding-log window prevents that, at the cost of storing a timestamp per
 * request per key.
 *
 * The 2x burst is acceptable here because these limits are abuse backstops
 * rather than capacity reservations, and the thing that actually bounds cost —
 * the AI daily spend ceiling — is computed from a durable ledger and cannot be
 * gamed by window alignment. Paying per-request storage to close a 2x gap in a
 * backstop is the wrong trade.
 *
 * ── Failure is open, deliberately ─────────────────────────────────────────
 * If Redis is unreachable the request is counted in-process and allowed
 * through. Failing closed would turn a cache outage into a total outage — every
 * user locked out of their visa checklist because a counter was unavailable.
 * The blast radius of failing open is that limits become per-instance for the
 * duration, which is exactly where they were before Redis existed.
 */

export type HitResult = {
  totalHits: number;
  resetAt: Date;
  /** True when this count came from the per-process fallback rather than Redis. */
  degraded: boolean;
};

export type RateLimitResult = HitResult & {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

/** Per-process fallback. Also the store used when no REDIS_URL is configured. */
const local = new Map<string, { hits: number; resetAt: number }>();

/**
 * Bound the fallback map.
 *
 * The key space is user ids and IP addresses, which is unbounded from the
 * outside. Without a ceiling this is a slow memory leak that only shows up
 * under the traffic that makes it matter.
 */
const MAX_LOCAL_KEYS = 100_000;

function sweepLocal(now: number): void {
  if (local.size < MAX_LOCAL_KEYS) return;
  for (const [key, entry] of local) {
    if (entry.resetAt <= now) local.delete(key);
  }
  // Still full of live windows: drop the oldest rather than grow without limit.
  if (local.size >= MAX_LOCAL_KEYS) {
    const excess = local.size - MAX_LOCAL_KEYS + 1;
    let dropped = 0;
    for (const key of local.keys()) {
      local.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

function hitLocal(key: string, windowMs: number): HitResult {
  const now = Date.now();
  sweepLocal(now);

  const existing = local.get(key);
  if (!existing || existing.resetAt <= now) {
    const entry = { hits: 1, resetAt: now + windowMs };
    local.set(key, entry);
    return { totalHits: 1, resetAt: new Date(entry.resetAt), degraded: true };
  }

  existing.hits += 1;
  return { totalHits: existing.hits, resetAt: new Date(existing.resetAt), degraded: true };
}

/**
 * INCR plus a TTL, atomically.
 *
 * The naive two-command version has a real failure mode: if the process dies
 * between INCR and PEXPIRE, the key has no expiry and that caller is limited
 * forever. Doing both in one script removes the window, and re-checking PTTL on
 * every hit self-heals any key that somehow lost its expiry anyway.
 */
const HIT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}
`;

async function hitRedis(key: string, windowMs: number): Promise<HitResult | null> {
  if (!redis) return null;
  try {
    const [hits, ttl] = (await redis.eval(HIT_SCRIPT, 1, key, String(windowMs))) as [
      number,
      number,
    ];
    return {
      totalHits: Number(hits),
      resetAt: new Date(Date.now() + Number(ttl)),
      degraded: false,
    };
  } catch (err) {
    // Counted in-process instead. See the failure-is-open note above.
    console.error("rate limit: Redis unavailable, counting in-process:", (err as Error).message);
    return null;
  }
}

/** Record one hit against `key`. Redis when available, per-process otherwise. */
export async function hit(key: string, windowMs: number): Promise<HitResult> {
  const fromRedis = await hitRedis(key, windowMs);
  return fromRedis ?? hitLocal(key, windowMs);
}

/** Record a hit and decide whether it is allowed. */
export async function consume(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const result = await hit(key, windowMs);
  const remaining = Math.max(0, limit - result.totalHits);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
  );

  return {
    ...result,
    allowed: result.totalHits <= limit,
    limit,
    remaining,
    retryAfterSeconds,
  };
}

/** Undo a hit. Used by the HTTP limiter when a request should not have counted. */
export async function release(key: string): Promise<void> {
  if (redis) {
    try {
      await redis.decr(key);
      return;
    } catch {
      /* fall through to the local store */
    }
  }
  const entry = local.get(key);
  if (entry && entry.hits > 0) entry.hits -= 1;
}

export async function resetKey(key: string): Promise<void> {
  if (redis) {
    try {
      await redis.del(key);
    } catch {
      /* fall through */
    }
  }
  local.delete(key);
}

/** Test seam. Clears the per-process store only — Redis keys expire on their own. */
export function resetLocalRateLimits(): void {
  local.clear();
}

/**
 * Normalise a client address into a limiter key.
 *
 * IPv6 is masked to its /64. A residential IPv6 allocation is routinely a /64
 * or larger, so keying on the full address lets one connection walk through
 * billions of distinct keys and never hit a limit — the limiter would be
 * decorative for exactly the users most likely to have IPv6.
 *
 * IPv4 is used whole: addresses are scarce enough that NAT already makes them
 * shared, and masking further would punish an entire campus for one caller.
 */
export function normalizeIp(ip: string | undefined): string {
  if (!ip) return "unknown";

  // Express reports IPv4-mapped IPv6 as "::ffff:1.2.3.4".
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];

  if (!ip.includes(":")) return ip;

  // Expand only as far as needed to take the first four hextets (/64).
  const [head] = ip.split("%"); // strip any zone index
  const parts = head.split("::");
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts.length > 1 && parts[1] ? parts[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  const full = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right];

  return `${full.slice(0, 4).join(":")}::/64`;
}
