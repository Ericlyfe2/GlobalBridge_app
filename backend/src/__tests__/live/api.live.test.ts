import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { LIVE_DATABASE_URL } from "./harness";
import type { Express } from "express";

/**
 * The API against a real database.
 *
 * Every other route test in this repo mocks `query()`, which means the SQL is
 * never parsed, never planned, and never run. A window function the planner
 * rejects, a column that no migration creates, an `ORDER BY` that does not
 * match the index — all of it passes a mocked suite.
 *
 * Here the only thing mocked is Firebase, because verifying a real ID token
 * needs credentials this environment does not have. Everything from the route
 * handler down is real.
 */

// Must be set before the db module is imported, since the pool is built at
// module load from this value.
process.env.DATABASE_URL = LIVE_DATABASE_URL;

const verifyIdToken = vi.fn();
vi.mock("../../lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken },
  adminMessaging: { send: vi.fn() },
}));

const AUTH = "Bearer live-token";
const FIREBASE_UID = "live-api-uid";

let app: Express;
let query: typeof import("../../db").query;
let userId: string;

beforeAll(async () => {
  ({ query } = await import("../../db"));
  const { createApp } = await import("../../app");
  app = createApp();

  verifyIdToken.mockResolvedValue({ uid: FIREBASE_UID, email: "live@example.com" });

  const [user] = await query<{ id: string }>(
    `INSERT INTO users (firebase_uid, email, full_name, role, preferred_language,
                        timezone, country_of_origin, country_of_residence, profile_completed_at)
     VALUES ($1, 'live@example.com', 'Live Tester', 'student', 'en',
             'Africa/Accra', 'Ghana', 'Canada', NOW())
     ON CONFLICT (firebase_uid) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id`,
    [FIREBASE_UID],
  );
  userId = user.id;
});

afterAll(async () => {
  const { pool } = await import("../../db");
  await pool.end();
});

describe("GET /home", () => {
  it("runs every one of its statements against real Postgres", async () => {
    const res = await request(app).get("/api/v1/home").set("Authorization", AUTH);

    // A 500 here means one of the eight parallel statements did not parse or
    // referenced something no migration creates.
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user.full_name).toBe("Live Tester");
    expect(res.body.unread).toEqual({ messages: 0, notifications: 0 });
  });

  it("computes checklist progress in SQL", async () => {
    await query(
      `INSERT INTO visa_checklists (user_id, origin_country, destination_country, visa_type, items, completed_items)
       VALUES ($1, 'Ghana', 'Canada', 'study',
               '[{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"}]'::jsonb,
               ARRAY['a','b'])`,
      [userId],
    );

    const res = await request(app).get("/api/v1/home").set("Authorization", AUTH);

    // jsonb_array_length and array_length actually evaluated, rather than a
    // mock returning whatever the test author expected.
    expect(res.body.checklist).toMatchObject({ total: 4, completed: 2, percent: 50 });
  });

  it("finds the nearest deadline among saved opportunities only", async () => {
    const [saved] = await query<{ id: string }>(
      `INSERT INTO opportunities (type, title, description, country, deadline)
       VALUES ('scholarship', 'Saved and closing soon', 'd', 'Canada', CURRENT_DATE + 10)
       RETURNING id`,
    );
    // Closes sooner, but the user never saved it, so it is browsing rather than
    // "your next deadline".
    await query(
      `INSERT INTO opportunities (type, title, description, country, deadline)
       VALUES ('scholarship', 'Not saved, closing sooner', 'd', 'Canada', CURRENT_DATE + 2)`,
    );
    await query(
      `INSERT INTO saved_items (user_id, item_type, item_id) VALUES ($1, 'opportunity', $2)
       ON CONFLICT DO NOTHING`,
      [userId, saved.id],
    );

    const res = await request(app).get("/api/v1/home").set("Authorization", AUTH);

    expect(res.body.next_deadline?.title).toBe("Saved and closing soon");
    expect(res.body.next_deadline?.days_left).toBe(10);
  });

  it("counts unread messages and notifications correctly", async () => {
    const [other] = await query<{ id: string }>(
      `INSERT INTO users (firebase_uid, email, full_name, role)
       VALUES ('live-other', 'other@example.com', 'Other', 'student')
       ON CONFLICT (firebase_uid) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
    );
    const [conversation] = await query<{ id: string }>(
      `INSERT INTO conversations (participant_a, participant_b) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING id`,
      [userId, other.id],
    );

    await query(
      `INSERT INTO messages (conversation_id, sender_id, body, is_read)
       VALUES ($1, $2, 'unread one', FALSE), ($1, $2, 'unread two', FALSE),
              ($1, $3, 'my own message', FALSE)`,
      [conversation.id, other.id, userId],
    );
    await query(
      `INSERT INTO notifications (user_id, kind, title, read)
       VALUES ($1, 'deadline', 'Deadline soon', FALSE), ($1, 'security', 'Check this', FALSE)`,
      [userId],
    );

    const res = await request(app).get("/api/v1/home").set("Authorization", AUTH);

    // The user's own messages must not count as unread to them.
    expect(res.body.unread.messages).toBe(2);
    expect(res.body.unread.notifications).toBe(2);
    // security and deadline are the two kinds that surface on the home screen.
    expect(res.body.alerts).toHaveLength(2);
  });

  it("issues a working ETag against real data", async () => {
    const first = await request(app).get("/api/v1/home").set("Authorization", AUTH);
    const second = await request(app)
      .get("/api/v1/home")
      .set("Authorization", AUTH)
      .set("If-None-Match", first.headers["etag"]);

    expect(second.status).toBe(304);
  });
});

describe("GET /sync", () => {
  it("runs every collection query against real Postgres", async () => {
    const res = await request(app).get("/api/v1/sync").set("Authorization", AUTH);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.full_resync).toBe(true);
    expect(Object.keys(res.body.collections).sort()).toEqual([
      "checklists",
      "conversations",
      "messages",
      "notifications",
      "saved_items",
    ]);
  });

  it("returns rows the user owns and advances the cursor past them", async () => {
    const res = await request(app).get("/api/v1/sync").set("Authorization", AUTH);

    expect(res.body.collections.notifications.length).toBeGreaterThan(0);
    expect(res.body.collections.messages.length).toBeGreaterThan(0);

    const cursor = new Date(res.body.cursor).getTime();
    for (const row of res.body.collections.notifications) {
      expect(new Date(row.created_at).getTime()).toBeLessThanOrEqual(cursor);
    }
  });

  it("returns nothing new when asked again with the returned cursor", async () => {
    const first = await request(app).get("/api/v1/sync").set("Authorization", AUTH);
    const second = await request(app)
      .get(`/api/v1/sync?since=${encodeURIComponent(first.body.cursor)}`)
      .set("Authorization", AUTH);

    expect(second.body.full_resync).toBe(false);
    for (const rows of Object.values(second.body.collections)) {
      expect(rows).toHaveLength(0);
    }
  });

  it("excludes another user's messages", async () => {
    const [stranger] = await query<{ id: string }>(
      `INSERT INTO users (firebase_uid, email, full_name, role)
       VALUES ('live-stranger', 'stranger@example.com', 'Stranger', 'student')
       ON CONFLICT (firebase_uid) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
    );
    const [third] = await query<{ id: string }>(
      `INSERT INTO users (firebase_uid, email, full_name, role)
       VALUES ('live-third', 'third@example.com', 'Third', 'student')
       ON CONFLICT (firebase_uid) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
    );
    const [privateConvo] = await query<{ id: string }>(
      `INSERT INTO conversations (participant_a, participant_b) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING id`,
      [stranger.id, third.id],
    );
    await query(
      `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, 'not for you')`,
      [privateConvo.id, stranger.id],
    );

    const res = await request(app).get("/api/v1/sync").set("Authorization", AUTH);
    const bodies = res.body.collections.messages.map((m: { body: string }) => m.body);

    expect(bodies).not.toContain("not for you");
  });

  it("returns an authoritative saved-item id list", async () => {
    const res = await request(app).get("/api/v1/sync").set("Authorization", AUTH);
    expect(res.body.saved_item_ids.complete).toBe(true);
    expect(res.body.saved_item_ids.ids.length).toBeGreaterThan(0);
  });
});

describe("pagination past the first page", () => {
  beforeAll(async () => {
    const [landlord] = await query<{ id: string }>(
      `INSERT INTO users (firebase_uid, email, full_name, role, verification_status)
       VALUES ('live-landlord', 'landlord@example.com', 'Landlord', 'employer', 'verified')
       ON CONFLICT (firebase_uid) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
    );

    // More than the 100 limit cap, so the last page is a real partial page.
    await query(
      `INSERT INTO housing_listings
         (landlord_id, title, city, country, rent_amount, currency, status, rating, created_at)
       SELECT $1,
              'Live listing ' || g,
              'Toronto', 'Canada',
              900 + g, 'CAD', 'active',
              (g % 5),
              NOW() - (g || ' minutes')::interval
         FROM generate_series(1, 150) g`,
      [landlord.id],
    );
  });

  it("pages all the way to the end without repeating or dropping a row", async () => {
    // The bug this is for: an endpoint that caps at one page silently looks
    // like "there is nothing else" on a Load more button and like a list that
    // just stops on infinite scroll. Both are a 200 with rows in it.
    const seen = new Set<string>();
    let offset = 0;
    let total = -1;
    let pages = 0;

    for (;;) {
      const res = await request(app).get(`/api/v1/housing?limit=40&offset=${offset}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      total = res.body.total;
      for (const item of res.body.items) seen.add(item.id);
      pages += 1;
      offset += res.body.items.length;

      if (!res.body.hasMore) break;
      expect(pages).toBeLessThan(20);
    }

    expect(total).toBeGreaterThanOrEqual(150);
    // No duplicates across page boundaries: the ORDER BY has to be total, which
    // is why it ends in a tiebreak on id.
    expect(seen.size).toBe(total);
    expect(pages).toBeGreaterThan(3);
  });

  it("reports hasMore from a real count rather than a full page", async () => {
    const res = await request(app).get("/api/v1/housing?limit=100&offset=0");
    expect(res.body.items).toHaveLength(100);
    expect(res.body.hasMore).toBe(true);
  });

  it("refuses a limit above the cap", async () => {
    const res = await request(app).get("/api/v1/housing?limit=5000");
    expect(res.status).toBe(400);
  });

  it("returns an empty terminal page past the end", async () => {
    const res = await request(app).get("/api/v1/housing?limit=20&offset=100000");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.hasMore).toBe(false);
  });
});

describe("LIKE escaping", () => {
  beforeAll(async () => {
    await query(
      `INSERT INTO opportunities (type, title, description, country)
       VALUES ('grant', 'Ordinary title', 'nothing special', 'Canada'),
              ('grant', 'Contains 100% funding', 'literal percent', 'Canada'),
              ('grant', 'Under_score in title', 'literal underscore', 'Canada')`,
    );
  });

  it("treats a literal % as text, not as match-everything", async () => {
    const all = await request(app).get("/api/v1/opportunities?limit=100");
    const wildcard = await request(app).get("/api/v1/opportunities?q=%25&limit=100");

    // Without escapeLike this returns the entire table, and the search box
    // silently stops filtering. It is not an injection -- the value is bound --
    // which is exactly why it survives review.
    expect(all.body.total).toBeGreaterThan(1);
    expect(wildcard.body.total).toBeLessThan(all.body.total);
    for (const item of wildcard.body.items) {
      expect(item.title).toContain("%");
    }
  });

  it("treats a literal _ as text, not as match-any-character", async () => {
    const res = await request(app).get("/api/v1/opportunities?q=_&limit=100");
    for (const item of res.body.items) {
      expect(item.title + "").toContain("_");
    }
  });

  it("still matches ordinary search terms", async () => {
    const res = await request(app).get("/api/v1/opportunities?q=Ordinary&limit=100");
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.items[0].title).toContain("Ordinary");
  });
});
