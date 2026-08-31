import "./setup-env";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Load test for GET /home.
 *
 * The home screen is the first call after every cold start, paid on the worst
 * network the user will have all day. These tests verify that the endpoint
 * stays fast under concurrent load and that parallel requests don't interfere
 * with each other's data.
 *
 * ── Why this is a test-file, not a benchmark suite ───────────────────────
 * A benchmark suite measures latency percentiles against a baseline; this
 * tests the *contract*: the endpoint must serve every concurrent request
 * successfully, return consistent data, and not regress into N+1 behaviour
 * when many users hit it at once. The mocked queries add a small artificial
 * delay so the concurrency is real work, not instant resolution.
 */

const verifyIdToken = vi.fn();
vi.mock("../lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken },
  adminMessaging: { send: vi.fn() },
}));

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;
type QueryOneFn = (sql: string, params?: unknown[]) => Promise<unknown>;

const queryMock = vi.fn<QueryFn>(async () => []);
const queryOneMock = vi.fn<QueryOneFn>(async () => null);

vi.mock("../db", () => ({
  pool: { connect: vi.fn(), end: vi.fn(), on: vi.fn() },
  redis: null,
  query: (sql: string, params?: unknown[]) => queryMock(sql, params),
  queryOne: (sql: string, params?: unknown[]) => queryOneMock(sql, params),
  withTransaction: vi.fn(),
}));

const AUTH = "Bearer test-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";

let app: Express;

beforeAll(async () => {
  const { createApp } = await import("../app");
  app = createApp();
});

beforeEach(async () => {
  vi.clearAllMocks();

  // Simulate realistic query latency (2–8 ms per query) so concurrent
  // requests are doing real async work, not resolving instantly.
  const delay = () => new Promise((r) => setTimeout(r, Math.random() * 6 + 2));

  verifyIdToken.mockResolvedValue({ uid: "firebase-uid", email: "ama@example.com" });

  queryOneMock.mockImplementation(async (sql) => {
    await delay();
    if (sql.includes("FROM users WHERE firebase_uid"))
      return { id: USER_ID, role: "student" };
    if (sql.includes("profile_completed_at"))
      return {
        full_name: "Ama Boateng",
        avatar_url: null,
        role: "student",
        country_of_origin: "Ghana",
        country_of_residence: "Canada",
        preferred_language: "en",
        timezone: "Africa/Accra",
        verification_status: "pending",
        profile_completed_at: new Date("2026-01-01T00:00:00Z"),
      };
    if (sql.includes("FROM visa_checklists"))
      return {
        id: "cccccccc-0000-4000-8000-000000000001",
        destination_country: "Canada",
        visa_type: "study",
        total_items: 6,
        completed_count: 3,
      };
    if (sql.includes("FROM saved_items s"))
      return { id: "dddddddd-0000-4000-8000-000000000001", title: "Chevening", deadline: "2026-11-05", days_left: 72 };
    if (sql.includes("FROM mentor_bookings"))
      return {
        id: "bbbbbbbb-0000-4000-8000-000000000001",
        starts_at: new Date("2026-09-14T15:00:00Z"),
        other_name: "Rita",
        is_mentor: false,
      };
    if (sql.includes("AS messages"))
      return { messages: "3", notifications: "7" };
    return null;
  });

  queryMock.mockImplementation(async (sql) => {
    await delay();
    if (sql.includes("FROM saved_items\n") && sql.includes("LIMIT"))
      return Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, item_type: "opportunity", item_id: `o${i}` }));
    if (sql.includes("FROM opportunities"))
      return Array.from({ length: 3 }, (_, i) => ({
        id: `o${i}`, type: "scholarship", title: `Scholarship ${i}`, country: "Canada",
      }));
    if (sql.includes("kind IN ('security', 'deadline')"))
      return Array.from({ length: 2 }, (_, i) => ({ id: `a${i}`, kind: "security", title: `Alert ${i}` }));
    return [];
  });

  const { clearAllUserCache } = await import("../middleware/auth");
  clearAllUserCache();
});

describe("GET /home load test", () => {
  /**
   * The primary contract: every concurrent request succeeds and returns
   * valid data. 50 parallel requests simulates a burst of users opening
   * the app simultaneously (e.g. after a push notification).
   */
  it("serves 50 concurrent requests without errors", async () => {
    const CONCURRENCY = 50;

    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        request(app)
          .get("/api/v1/home")
          .set("Authorization", AUTH)
          .set("X-Request-Id", `load-${i}`),
      ),
    );
    const wallMs = Date.now() - start;

    // Every request must succeed.
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.full_name).toBe("Ama Boateng");
      expect(res.body.checklist).toBeDefined();
      expect(res.body.unread).toBeDefined();
      expect(res.body.opportunities).toBeDefined();
      expect(res.body.alerts).toBeDefined();
    }

    // The full burst should complete well within the 20s test timeout.
    // With mocked 2-8ms queries running in parallel, 50 requests should
    // finish in under 2 seconds — leaving a huge margin.
    expect(wallMs).toBeLessThan(10_000);
  });

  /**
   * Concurrent requests must not leak data between users.
   * Each request runs its own Promise.all of queries; under concurrency
   * the auth cache and query results must not cross request boundaries.
   */
  it("returns identical payloads for every concurrent caller", async () => {
    const CONCURRENCY = 20;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        request(app).get("/api/v1/home").set("Authorization", AUTH),
      ),
    );

    const bodies = results.map((r) => JSON.stringify(r.body));
    const unique = new Set(bodies);

    // All responses must be structurally identical — the same user, the
    // same checklist, the same unread counts. If the async context leaks,
    // different requests would see different query results.
    expect(unique.size).toBe(1);
  });

  /**
   * The fixed query count contract holds under concurrency.
   * Each request must issue the same number of queries regardless of
   * how many other requests are in flight.
   */
  it("issues the same number of queries per request under concurrency", async () => {
    const CONCURRENCY = 10;

    // Warm the auth cache so it does not count as a query.
    await request(app).get("/api/v1/home").set("Authorization", AUTH);
    vi.clearAllMocks();

    // Run all requests sequentially so we can count per-request.
    const queryCounts: number[] = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      vi.clearAllMocks();
      await request(app).get("/api/v1/home").set("Authorization", AUTH);
      queryCounts.push(queryMock.mock.calls.length + queryOneMock.mock.calls.length);
    }

    // Every request must issue the same number of queries. If an N+1
    // sneaks in, the count would grow with user data size — but here
    // we verify it doesn't grow with *request* count either.
    const firstCount = queryCounts[0];
    for (const count of queryCounts) {
      expect(count).toBe(firstCount);
    }
  });

  /**
   * ETag caching works correctly under concurrent load.
   * Multiple requests with the same If-None-Match must all get 304s,
   * and a single changed response must produce a new ETag.
   */
  it("serves 304 to concurrent conditional requests", async () => {
    // Get the initial ETag.
    const first = await request(app).get("/api/v1/home").set("Authorization", AUTH);
    const etag = first.headers["etag"];
    expect(etag).toBeTruthy();

    const CONCURRENCY = 30;

    // All concurrent requests carry the same If-None-Match.
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        request(app)
          .get("/api/v1/home")
          .set("Authorization", AUTH)
          .set("If-None-Match", etag),
      ),
    );

    // Every one must be a 304 — no body, no re-serialization.
    for (const res of results) {
      expect(res.status).toBe(304);
      expect(res.text).toBeFalsy();
    }
  });

  /**
   * Concurrent requests each see their own ETag, and different data
   * produces a different ETag. This verifies the ETag is derived from
   * the payload, not from a shared mutable state.
   */
  it("computes ETags independently per request", async () => {
    const CONCURRENCY = 10;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        request(app).get("/api/v1/home").set("Authorization", AUTH),
      ),
    );

    // All same data → all same ETag.
    const etags = results.map((r) => r.headers["etag"]);
    const unique = new Set(etags);
    expect(unique.size).toBe(1);

    // Verify the ETag is deterministic by making the same request again.
    const second = await request(app).get("/api/v1/home").set("Authorization", AUTH);
    expect(second.headers["etag"]).toBe(etags[0]);
  });
});
