import "./setup-env";
import { describe, it, expect, beforeEach, vi } from "vitest";
import RedisMock from "ioredis-mock";

/**
 * The rate-limit Lua script, executed by a real Lua interpreter.
 *
 * The other rate-limit suite drives a hand-written fake that emulates what I
 * believe the script does — which cannot catch a mistake *in* the script,
 * because the fake is a second statement of the same belief. Here the actual
 * script text runs against an implementation of the Redis command set, so the
 * branching, the argument coercion and the return shape are exercised.
 *
 * Not a substitute for real Redis: no network, no eviction, no clustering, and
 * the TTL is emulated. What it does prove is that the script is valid Lua that
 * uses the commands correctly and returns what the caller unpacks.
 */

const redisMock = new RedisMock();

vi.mock("../db", () => ({
  pool: { connect: vi.fn(), end: vi.fn(), on: vi.fn() },
  redis: redisMock,
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  withTransaction: vi.fn(),
}));

beforeEach(async () => {
  await redisMock.flushall();
  const { resetLocalRateLimits } = await import("../lib/rate-limit");
  resetLocalRateLimits();
});

describe("the counter script", () => {
  it("starts a window on the first hit and reports it as served by Redis", async () => {
    const { consume } = await import("../lib/rate-limit");

    const first = await consume("script:first", 5, 60_000);

    expect(first.totalHits).toBe(1);
    expect(first.allowed).toBe(true);
    // Not the in-process fallback: the script really ran.
    expect(first.degraded).toBe(false);
  });

  it("increments across calls and enforces the limit", async () => {
    const { consume } = await import("../lib/rate-limit");

    for (let i = 1; i <= 3; i++) {
      const result = await consume("script:count", 3, 60_000);
      expect(result.totalHits).toBe(i);
      expect(result.allowed).toBe(true);
    }

    const fourth = await consume("script:count", 3, 60_000);
    expect(fourth.totalHits).toBe(4);
    expect(fourth.allowed).toBe(false);
  });

  it("sets a TTL on the key it creates", async () => {
    const { consume } = await import("../lib/rate-limit");
    await consume("script:ttl", 5, 60_000);

    const ttl = await redisMock.pttl("script:ttl");

    // Without this the key never expires and that caller is limited forever.
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it("self-heals a key that lost its expiry", async () => {
    // The failure this branch exists for: a process that dies between INCR and
    // PEXPIRE leaves a counter with no TTL. Under a naive two-command
    // implementation that key never resets and the account is locked out
    // permanently -- a support ticket nobody can diagnose.
    await redisMock.set("script:orphan", "7");
    expect(await redisMock.pttl("script:orphan")).toBeLessThan(0);

    const { consume } = await import("../lib/rate-limit");
    const result = await consume("script:orphan", 100, 60_000);

    expect(result.totalHits).toBe(8);
    expect(await redisMock.pttl("script:orphan")).toBeGreaterThan(0);
  });

  it("keeps separate keys independent", async () => {
    const { consume } = await import("../lib/rate-limit");

    await consume("script:a", 1, 60_000);
    await consume("script:a", 1, 60_000);
    const other = await consume("script:b", 1, 60_000);

    expect(other.totalHits).toBe(1);
    expect(other.allowed).toBe(true);
  });

  it("computes a reset time from the TTL the script returned", async () => {
    const { consume } = await import("../lib/rate-limit");
    const before = Date.now();

    const result = await consume("script:reset", 5, 30_000);

    expect(result.resetAt.getTime()).toBeGreaterThan(before);
    expect(result.resetAt.getTime()).toBeLessThanOrEqual(before + 30_000 + 50);
  });
});

describe("release and reset", () => {
  it("decrements a counter", async () => {
    const { consume, release } = await import("../lib/rate-limit");

    await consume("script:release", 5, 60_000);
    await consume("script:release", 5, 60_000);
    await release("script:release");

    const next = await consume("script:release", 5, 60_000);
    expect(next.totalHits).toBe(2);
  });

  it("clears a key entirely", async () => {
    const { consume, resetKey } = await import("../lib/rate-limit");

    await consume("script:clear", 5, 60_000);
    await resetKey("script:clear");

    const next = await consume("script:clear", 5, 60_000);
    expect(next.totalHits).toBe(1);
  });
});
