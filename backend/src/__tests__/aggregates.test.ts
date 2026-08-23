import "./setup-env";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { etagFor } from "../lib/etag";

/**
 * The aggregate endpoints.
 *
 * The properties under test are the ones that decide whether these are worth
 * having: a fixed query count, bounded payloads, a working 304, and a delta
 * protocol that does not silently strand deleted rows on the client.
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

/** Rows the home queries return. Tuned per test. */
let profile: Record<string, unknown> | null;
let checklist: Record<string, unknown> | null;
let nextDeadline: Record<string, unknown> | null;
let nextBooking: Record<string, unknown> | null;
let unread: Record<string, unknown> | null;
let savedRows: unknown[];
let opportunityRows: unknown[];
let alertRows: unknown[];

/** Rows the sync queries return. */
let syncRows: Record<string, unknown[]>;

beforeEach(async () => {
  vi.clearAllMocks();

  profile = {
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
  checklist = {
    id: "cccccccc-0000-4000-8000-000000000001",
    destination_country: "Canada",
    visa_type: "study",
    total_items: 6,
    completed_count: 3,
  };
  nextDeadline = null;
  nextBooking = null;
  unread = { messages: "2", notifications: "5" };
  savedRows = [];
  opportunityRows = [];
  alertRows = [];

  syncRows = {
    notifications: [],
    messages: [],
    conversations: [],
    checklists: [],
    saved_changed: [],
    saved_ids: [],
  };

  verifyIdToken.mockResolvedValue({ uid: "firebase-uid", email: "ama@example.com" });

  queryOneMock.mockImplementation(async (sql) => {
    if (sql.includes("FROM users WHERE firebase_uid")) return { id: USER_ID, role: "student" };
    if (sql.includes("profile_completed_at\n           FROM users")) return profile;
    if (sql.includes("FROM users WHERE id = $1")) return profile;
    if (sql.includes("FROM visa_checklists")) return checklist;
    if (sql.includes("FROM saved_items s")) return nextDeadline;
    if (sql.includes("FROM mentor_bookings")) return nextBooking;
    if (sql.includes("AS messages")) return unread;
    return null;
  });

  queryMock.mockImplementation(async (sql) => {
    // home
    if (sql.includes("FROM saved_items\n          WHERE user_id = $1\n          ORDER BY created_at DESC\n          LIMIT")) {
      return savedRows;
    }
    if (sql.includes("FROM opportunities")) return opportunityRows;
    if (sql.includes("kind IN ('security', 'deadline')")) return alertRows;
    // sync
    if (sql.includes("FROM notifications")) return syncRows.notifications;
    if (sql.includes("FROM messages m")) return syncRows.messages;
    if (sql.includes("FROM conversations c")) return syncRows.conversations;
    if (sql.includes("FROM visa_checklists")) return syncRows.checklists;
    if (sql.includes("SELECT id FROM saved_items")) return syncRows.saved_ids;
    if (sql.includes("FROM saved_items")) return syncRows.saved_changed;
    return [];
  });

  const { clearAllUserCache } = await import("../middleware/auth");
  clearAllUserCache();
});

describe("GET /home", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/home");
    expect(res.status).toBe(401);
  });

  it("returns the whole first screen in one call", async () => {
    const res = await request(app).get("/api/v1/home").set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.user.full_name).toBe("Ama Boateng");
    expect(res.body.checklist).toMatchObject({ total: 6, completed: 3, percent: 50 });
    expect(res.body.unread).toEqual({ messages: 2, notifications: 5 });
    expect(res.body).toHaveProperty("opportunities");
    expect(res.body).toHaveProperty("saved");
    expect(res.body).toHaveProperty("alerts");
  });

  it("issues a fixed number of queries regardless of how much data exists", async () => {
    // Warm the auth user cache first. Its lookup is a real query on a cold
    // cache and would otherwise be counted against the first measurement only,
    // making the two runs differ for a reason that has nothing to do with the
    // handler.
    await request(app).get("/api/v1/home").set("Authorization", AUTH);

    vi.clearAllMocks();
    await request(app).get("/api/v1/home").set("Authorization", AUTH);
    const withNoData = queryMock.mock.calls.length + queryOneMock.mock.calls.length;

    vi.clearAllMocks();
    savedRows = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}` }));
    opportunityRows = Array.from({ length: 3 }, (_, i) => ({ id: `o${i}` }));
    alertRows = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}` }));

    await request(app).get("/api/v1/home").set("Authorization", AUTH);
    const withData = queryMock.mock.calls.length + queryOneMock.mock.calls.length;

    // The property that makes an N+1 impossible here rather than merely absent
    // today: the count does not move with the size of the result.
    expect(withData).toBe(withNoData);
  });

  it("bounds every list it returns", async () => {
    const statements = [...queryMock.mock.calls.map(([s]) => s)];
    await request(app).get("/api/v1/home").set("Authorization", AUTH);

    for (const sql of queryMock.mock.calls.map(([s]) => s).slice(statements.length)) {
      // A summary screen has no business returning an unbounded array to a
      // phone on a metered connection.
      expect(sql, sql.slice(0, 60)).toMatch(/LIMIT/);
    }
  });

  it("handles a user with no checklist, deadline or session", async () => {
    checklist = null;
    nextDeadline = null;
    nextBooking = null;

    const res = await request(app).get("/api/v1/home").set("Authorization", AUTH);

    expect(res.status).toBe(200);
    // Nulls, not omitted keys: the client renders an empty state from these and
    // a missing key is indistinguishable from a parse failure.
    expect(res.body.checklist).toBeNull();
    expect(res.body.next_deadline).toBeNull();
    expect(res.body.next_session).toBeNull();
  });

  it("reports a zero-item checklist without dividing by zero", async () => {
    checklist = { ...checklist!, total_items: 0, completed_count: 0 };
    const res = await request(app).get("/api/v1/home").set("Authorization", AUTH);
    expect(res.body.checklist.percent).toBe(0);
  });

  it("sends the next session as an absolute instant", async () => {
    nextBooking = {
      id: "bbbbbbbb-0000-4000-8000-000000000001",
      starts_at: new Date("2026-09-14T15:00:00Z"),
      other_name: "Rita",
      is_mentor: false,
    };

    const res = await request(app).get("/api/v1/home").set("Authorization", AUTH);

    // A preformatted local time would be wrong the moment the user travels,
    // which this audience does by definition.
    expect(res.body.next_session.starts_at).toBe("2026-09-14T15:00:00.000Z");
    expect(res.body.next_session.href).toContain("/bookings/");
  });
});

describe("GET /home caching", () => {
  it("is private and revalidated, never stored in a shared cache", async () => {
    const res = await request(app).get("/api/v1/home").set("Authorization", AUTH);

    // `private` keeps one user's home screen out of any shared cache; the rest
    // is what makes the ETag able to produce a 304 at all.
    expect(res.headers["cache-control"]).toBe("private, max-age=0, must-revalidate");
    expect(res.headers["vary"]).toContain("Authorization");
    expect(res.headers["etag"]).toMatch(/^W\//);
  });

  it("answers 304 when nothing has changed", async () => {
    const first = await request(app).get("/api/v1/home").set("Authorization", AUTH);
    const etag = first.headers["etag"];

    const second = await request(app)
      .get("/api/v1/home")
      .set("Authorization", AUTH)
      .set("If-None-Match", etag);

    expect(second.status).toBe(304);
    expect(second.text).toBeFalsy();
  });

  it("sends a fresh body once the data changes", async () => {
    const first = await request(app).get("/api/v1/home").set("Authorization", AUTH);

    unread = { messages: "9", notifications: "5" };

    const second = await request(app)
      .get("/api/v1/home")
      .set("Authorization", AUTH)
      .set("If-None-Match", first.headers["etag"]);

    expect(second.status).toBe(200);
    expect(second.body.unread.messages).toBe(9);
  });

  it("matches a strong tag against our weak one", async () => {
    const first = await request(app).get("/api/v1/home").set("Authorization", AUTH);
    const strong = first.headers["etag"].replace(/^W\//, "");

    const second = await request(app)
      .get("/api/v1/home")
      .set("Authorization", AUTH)
      .set("If-None-Match", strong);

    expect(second.status).toBe(304);
  });

  it("matches when the client sends a list of tags", async () => {
    const first = await request(app).get("/api/v1/home").set("Authorization", AUTH);

    const second = await request(app)
      .get("/api/v1/home")
      .set("Authorization", AUTH)
      .set("If-None-Match", `W/"stale-one", ${first.headers["etag"]}`);

    expect(second.status).toBe(304);
  });

  it("carries no volatile field that would break every revalidation", async () => {
    const res = await request(app).get("/api/v1/home").set("Authorization", AUTH);
    const body = JSON.stringify(res.body);

    // A generated-at timestamp would change the hash on every request and turn
    // the ETag into decoration.
    expect(body).not.toMatch(/generated_at|server_time|requested_at/);
  });
});

describe("etagFor", () => {
  it("is stable for equal payloads and different for changed ones", () => {
    expect(etagFor({ a: 1, b: [2, 3] })).toBe(etagFor({ a: 1, b: [2, 3] }));
    expect(etagFor({ a: 1 })).not.toBe(etagFor({ a: 2 }));
  });
});

describe("GET /sync", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/sync");
    expect(res.status).toBe(401);
  });

  it("treats a first call as a full resync rather than a full history dump", async () => {
    const res = await request(app).get("/api/v1/sync").set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.full_resync).toBe(true);

    // An unbounded backfill over a metered connection is a bill, not a feature.
    for (const [, params] of queryMock.mock.calls) {
      if (!params) continue;
      const cursor = params[1];
      if (cursor instanceof Date) {
        expect(Date.now() - cursor.getTime()).toBeLessThanOrEqual(31 * 24 * 60 * 60 * 1000);
      }
    }
  });

  it("does a delta for a recent cursor", async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .get(`/api/v1/sync?since=${encodeURIComponent(since)}`)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.full_resync).toBe(false);
  });

  it("forces a full resync when the cursor is older than the horizon", async () => {
    // Without tombstones a long-stale delta cannot describe deletions, so the
    // honest move is to tell the client to start over.
    const ancient = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .get(`/api/v1/sync?since=${encodeURIComponent(ancient)}`)
      .set("Authorization", AUTH);

    expect(res.body.full_resync).toBe(true);
  });

  it("advances the cursor to the newest row, not to now", async () => {
    const newest = "2026-08-20T10:00:00.000Z";
    syncRows.notifications = [
      { id: "n1", created_at: "2026-08-20T09:00:00.000Z", updated: "2026-08-20T09:00:00.000Z" },
      { id: "n2", created_at: newest, updated: newest },
    ];

    const since = new Date("2026-08-19T00:00:00Z").toISOString();
    const res = await request(app)
      .get(`/api/v1/sync?since=${encodeURIComponent(since)}`)
      .set("Authorization", AUTH);

    // Using the server clock would skip anything written between the query and
    // the response.
    expect(res.body.cursor).toBe(newest);
  });

  it("keeps the cursor where it was when nothing changed", async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const res = await request(app)
      .get(`/api/v1/sync?since=${encodeURIComponent(since.toISOString())}`)
      .set("Authorization", AUTH);

    expect(new Date(res.body.cursor).getTime()).toBe(since.getTime());
  });

  it("returns an authoritative saved-item id list so deletions can be reconciled", async () => {
    syncRows.saved_ids = [{ id: "s1" }, { id: "s2" }];

    const res = await request(app).get("/api/v1/sync").set("Authorization", AUTH);

    // A "changed since" query cannot report a row that no longer exists, so
    // without this an unsave on one device never reaches another.
    expect(res.body.saved_item_ids.complete).toBe(true);
    expect(res.body.saved_item_ids.ids).toEqual(["s1", "s2"]);
  });

  it("refuses to hand back a truncated id list the client would act on", async () => {
    syncRows.saved_ids = Array.from({ length: 1001 }, (_, i) => ({ id: `s${i}` }));

    const res = await request(app).get("/api/v1/sync").set("Authorization", AUTH);

    // Reconciling deletions against a truncated list would delete real rows
    // from the client's cache.
    expect(res.body.saved_item_ids.complete).toBe(false);
    expect(res.body.saved_item_ids.ids).toEqual([]);
  });

  it("flags more work when a collection fills its page", async () => {
    syncRows.messages = Array.from({ length: 100 }, (_, i) => ({
      id: `m${i}`,
      updated: "2026-08-20T10:00:00.000Z",
    }));

    const res = await request(app).get("/api/v1/sync").set("Authorization", AUTH);
    expect(res.body.has_more).toBe(true);
  });

  it("caps the page size a client can ask for", async () => {
    const res = await request(app).get("/api/v1/sync?limit=5000").set("Authorization", AUTH);
    expect(res.status).toBe(400);
  });

  it("never syncs documents, AI content or anything token-shaped", async () => {
    const res = await request(app).get("/api/v1/sync").set("Authorization", AUTH);

    expect(Object.keys(res.body.collections).sort()).toEqual([
      "checklists",
      "conversations",
      "messages",
      "notifications",
      "saved_items",
    ]);

    const statements = queryMock.mock.calls.map(([s]) => s).join(" ");
    // Identity paperwork is served through short-lived signed URLs precisely so
    // a copy does not persist somewhere unmanaged.
    expect(statements).not.toMatch(/user_documents|ai_messages|ai_conversations/);
  });

  it("is never stored in a shared cache", async () => {
    const res = await request(app).get("/api/v1/sync").set("Authorization", AUTH);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("rejects a cursor that is not a date", async () => {
    const res = await request(app).get("/api/v1/sync?since=yesterday").set("Authorization", AUTH);
    expect(res.status).toBe(400);
  });
});
