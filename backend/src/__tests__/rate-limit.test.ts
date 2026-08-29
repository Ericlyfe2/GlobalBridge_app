import "./setup-env";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request } from "express";

/**
 * The shared rate-limit counter.
 *
 * The properties worth pinning: the limit is actually enforced, an unreachable
 * Redis degrades to per-process counting rather than locking everyone out, and
 * the key derivation cannot be walked around by rotating IPv6 addresses.
 */

const evalMock = vi.fn();
const decrMock = vi.fn(async () => 0);
const delMock = vi.fn(async () => 1);

vi.mock("../db", () => ({
  pool: { connect: vi.fn(), end: vi.fn(), on: vi.fn() },
  redis: {
    eval: (...args: unknown[]) => evalMock(...args),
    decr: (...args: unknown[]) => decrMock(...(args as [])),
    del: (...args: unknown[]) => delMock(...(args as [])),
  },
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  withTransaction: vi.fn(),
}));

/** Emulates a Redis fixed-window counter over an in-memory map. */
function fakeRedisWindow() {
  const store = new Map<string, { hits: number; expiresAt: number }>();
  evalMock.mockImplementation(async (_script, _numKeys, key: string, windowMs: string) => {
    const now = Date.now();
    const existing = store.get(key);
    if (!existing || existing.expiresAt <= now) {
      store.set(key, { hits: 1, expiresAt: now + Number(windowMs) });
      return [1, Number(windowMs)];
    }
    existing.hits += 1;
    return [existing.hits, existing.expiresAt - now];
  });
  return store;
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { resetLocalRateLimits } = await import("../lib/rate-limit");
  resetLocalRateLimits();
});

describe("consume", () => {
  it("allows exactly the limit, then refuses", async () => {
    fakeRedisWindow();
    const { consume } = await import("../lib/rate-limit");

    for (let i = 1; i <= 5; i++) {
      const result = await consume("test:allow", 5, 60_000);
      expect(result.allowed, `call ${i}`).toBe(true);
      expect(result.remaining).toBe(5 - i);
    }

    const sixth = await consume("test:allow", 5, 60_000);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each key separately", async () => {
    fakeRedisWindow();
    const { consume } = await import("../lib/rate-limit");

    await consume("test:a", 1, 60_000);
    const other = await consume("test:b", 1, 60_000);

    expect(other.allowed).toBe(true);
  });

  it("starts a fresh window once the old one expires", async () => {
    fakeRedisWindow();
    const { consume } = await import("../lib/rate-limit");

    await consume("test:window", 1, 20);
    expect((await consume("test:window", 1, 20)).allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 30));
    expect((await consume("test:window", 1, 20)).allowed).toBe(true);
  });

  it("reports a retry-after that is never zero", async () => {
    fakeRedisWindow();
    const { consume } = await import("../lib/rate-limit");

    await consume("test:retry", 1, 500);
    const blocked = await consume("test:retry", 1, 500);

    // A Retry-After of 0 tells a backing-off client to retry immediately,
    // which is the opposite of what it is for.
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("when Redis is unreachable", () => {
  it("keeps counting in-process instead of locking everyone out", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    evalMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { consume } = await import("../lib/rate-limit");

    const first = await consume("test:degraded", 3, 60_000);

    // Failing closed would turn a cache outage into a total outage: every user
    // locked out of their visa checklist because a counter was unavailable.
    expect(first.allowed).toBe(true);
    expect(first.degraded).toBe(true);
    warn.mockRestore();
  });

  it("still enforces the limit on the fallback path", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    evalMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { consume } = await import("../lib/rate-limit");

    await consume("test:degraded-limit", 2, 60_000);
    await consume("test:degraded-limit", 2, 60_000);
    const third = await consume("test:degraded-limit", 2, 60_000);

    // Degraded means per-instance, not unlimited.
    expect(third.allowed).toBe(false);
    warn.mockRestore();
  });

  it("marks Redis-served counts as not degraded", async () => {
    fakeRedisWindow();
    const { consume } = await import("../lib/rate-limit");

    const result = await consume("test:healthy", 5, 60_000);
    expect(result.degraded).toBe(false);
  });
});

describe("normalizeIp", () => {
  it("passes IPv4 through whole", async () => {
    const { normalizeIp } = await import("../lib/rate-limit");
    expect(normalizeIp("203.0.113.7")).toBe("203.0.113.7");
  });

  it("unwraps IPv4-mapped IPv6, which is what Express reports", async () => {
    const { normalizeIp } = await import("../lib/rate-limit");
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("masks IPv6 to its /64", async () => {
    const { normalizeIp } = await import("../lib/rate-limit");

    // A residential IPv6 allocation is routinely a /64 or larger. Keying on the
    // full address lets one connection walk billions of keys and never hit a
    // limit -- the limiter would be decorative for exactly the users most
    // likely to have IPv6.
    const a = normalizeIp("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd");
    const b = normalizeIp("2001:db8:1234:5678:1111:2222:3333:4444");
    expect(a).toBe(b);
    expect(a).toBe("2001:db8:1234:5678::/64");
  });

  it("separates genuinely different /64s", async () => {
    const { normalizeIp } = await import("../lib/rate-limit");
    expect(normalizeIp("2001:db8:1234:5678::1")).not.toBe(normalizeIp("2001:db8:1234:9999::1"));
  });

  it("handles compressed notation and zone indices", async () => {
    const { normalizeIp } = await import("../lib/rate-limit");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("has an answer for a missing address", async () => {
    const { normalizeIp } = await import("../lib/rate-limit");
    expect(normalizeIp(undefined)).toBe("unknown");
  });
});

describe("limiterKey", () => {
  const asRequest = (headers: Record<string, string>, ip = "203.0.113.7") =>
    ({ headers, ip }) as unknown as Request;

  const token = (claims: object) =>
    `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

  it("keys by account when a bearer token carries one", async () => {
    const { limiterKey } = await import("../middleware/rate-limit");

    // The budget follows the person, not the building. Campus and carrier-grade
    // NAT put hundreds of unrelated users behind one address.
    expect(limiterKey(asRequest({ authorization: `Bearer ${token({ user_id: "abc" })}` }))).toBe(
      "u:abc",
    );
  });

  it("accepts the sub claim as well", async () => {
    const { limiterKey } = await import("../middleware/rate-limit");
    expect(limiterKey(asRequest({ authorization: `Bearer ${token({ sub: "xyz" })}` }))).toBe(
      "u:xyz",
    );
  });

  it("falls back to the address for anonymous traffic", async () => {
    const { limiterKey } = await import("../middleware/rate-limit");
    expect(limiterKey(asRequest({}))).toBe("ip:203.0.113.7");
  });

  it("falls back to the address for a malformed token", async () => {
    const { limiterKey } = await import("../middleware/rate-limit");

    // Reading claims off an unverified token is safe -- a forged one only moves
    // the request into a bucket the attacker chose, and real verification still
    // has to pass afterwards -- but it must never throw.
    expect(limiterKey(asRequest({ authorization: "Bearer not-a-jwt" }))).toBe("ip:203.0.113.7");
    expect(limiterKey(asRequest({ authorization: "Bearer a.!!!not-base64!!!.c" }))).toBe(
      "ip:203.0.113.7",
    );
  });

  it("masks the address in the fallback key too", async () => {
    const { limiterKey } = await import("../middleware/rate-limit");
    expect(limiterKey(asRequest({}, "2001:db8:1234:5678:aaaa::1"))).toBe(
      "ip:2001:db8:1234:5678::/64",
    );
  });
});
