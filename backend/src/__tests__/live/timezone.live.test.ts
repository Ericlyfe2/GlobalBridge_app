import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { LIVE_DATABASE_URL } from "./harness";
import { SAFE_TZ } from "../../lib/reminders/time";

/**
 * The reminder timezone conversion, against a real timezone database.
 *
 * This is the check the whole live pass was worth running for. `slot_date` is a
 * DATE and `slot_time` is a TIME; neither carries a zone, so "2026-09-14 15:00"
 * is a wall-clock reading rather than an instant. Getting the conversion wrong
 * fires everyone's reminder at the wrong hour, and a mocked `query()` cannot
 * tell the difference between the right answer and any other one — it never
 * runs the SQL.
 *
 * Postgres's timezone rules also cannot be reimplemented in a test double
 * without reimplementing the IANA database, DST transitions included. That is
 * precisely why this has to run against the real thing.
 */

let pool: Pool;

beforeAll(() => {
  pool = new Pool({ connectionString: LIVE_DATABASE_URL, max: 4 });
});

afterAll(async () => {
  await pool.end();
});

/** The exact expression the reminder query builds. */
async function resolveInstant(
  date: string,
  time: string,
  timezone: string | null,
): Promise<Date> {
  const { rows } = await pool.query<{ starts_at: Date }>(
    `SELECT ($1::date + $2::time) AT TIME ZONE ${SAFE_TZ("$3::text")} AS starts_at`,
    [date, time, timezone],
  );
  return rows[0].starts_at;
}

describe("wall clock to instant", () => {
  it("resolves 3pm in Accra to 15:00 UTC", async () => {
    // Ghana is UTC+0 year round, so this is the identity case that would also
    // pass with a completely broken implementation. It is here as a control.
    const instant = await resolveInstant("2026-09-14", "15:00", "Africa/Accra");
    expect(instant.toISOString()).toBe("2026-09-14T15:00:00.000Z");
  });

  it("resolves 3pm in Vancouver to 22:00 UTC during daylight saving", async () => {
    // A student in Accra and a mentor in Vancouver share one booking row and
    // are seven hours apart in September.
    const instant = await resolveInstant("2026-09-14", "15:00", "America/Vancouver");
    expect(instant.toISOString()).toBe("2026-09-14T22:00:00.000Z");
  });

  it("resolves the same wall clock to 23:00 UTC in January", async () => {
    // The load-bearing assertion. Vancouver is UTC-7 in September and UTC-8 in
    // January. An implementation that stored or assumed a fixed offset passes
    // the test above and fails this one, and in production would fire every
    // winter reminder an hour early for half the world.
    const instant = await resolveInstant("2026-01-14", "15:00", "America/Vancouver");
    expect(instant.toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("handles a half-hour offset zone", async () => {
    // India is UTC+5:30. Offsets are not whole hours, and arithmetic that
    // assumes they are is wrong for roughly a fifth of this product's users.
    const instant = await resolveInstant("2026-09-14", "15:00", "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-09-14T09:30:00.000Z");
  });

  it("handles a 45-minute offset zone", async () => {
    // Nepal is UTC+5:45.
    const instant = await resolveInstant("2026-09-14", "15:00", "Asia/Kathmandu");
    expect(instant.toISOString()).toBe("2026-09-14T09:15:00.000Z");
  });

  it("gives one instant that both participants share", async () => {
    // There is exactly one moment. The mentor's zone renders it; it does not
    // produce a second instant. If it did, the pair would get reminders for two
    // different times and one of them would show up alone.
    const fromStudentZone = await resolveInstant("2026-09-14", "15:00", "Africa/Accra");

    const rendered = new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Vancouver",
    }).format(fromStudentZone);

    expect(fromStudentZone.toISOString()).toBe("2026-09-14T15:00:00.000Z");
    expect(rendered).toBe("8:00 AM");
  });
});

describe("SAFE_TZ", () => {
  it("falls back to UTC for a zone Postgres does not know", async () => {
    // These strings come from client input. Postgres raises on an unknown zone,
    // and an exception here would abort the whole reminder pass over one bad
    // profile row — every user's reminders lost because one person's device
    // reported something odd.
    const instant = await resolveInstant("2026-09-14", "15:00", "Mars/Olympus");
    expect(instant.toISOString()).toBe("2026-09-14T15:00:00.000Z");
  });

  it("falls back to UTC for null", async () => {
    const instant = await resolveInstant("2026-09-14", "15:00", null);
    expect(instant.toISOString()).toBe("2026-09-14T15:00:00.000Z");
  });

  it("does not raise on an injection-shaped zone name", async () => {
    // The value is a bound parameter, so this is a lookup miss rather than SQL.
    const instant = await resolveInstant("2026-09-14", "15:00", "'; DROP TABLE users; --");
    expect(instant.toISOString()).toBe("2026-09-14T15:00:00.000Z");

    const { rows } = await pool.query("SELECT to_regclass('public.users') AS t");
    expect(rows[0].t).toBe("users");
  });

  it("accepts every zone name Postgres itself lists", async () => {
    // SAFE_TZ checks the candidate against pg_timezone_names, the same list the
    // conversion uses, so anything that passes the check is guaranteed to
    // convert rather than raise.
    const { rows } = await pool.query<{ name: string }>(
      "SELECT name FROM pg_timezone_names ORDER BY random() LIMIT 25",
    );
    for (const { name } of rows) {
      await expect(resolveInstant("2026-06-01", "12:00", name)).resolves.toBeInstanceOf(Date);
    }
  });
});

describe("the reminder query itself", () => {
  const dispatched: { userId: string; vars?: Record<string, string> }[] = [];

  beforeEach(() => {
    dispatched.length = 0;
    vi.resetModules();
  });

  it("selects a due booking and renders each side on its own clock", async () => {
    process.env.DATABASE_URL = LIVE_DATABASE_URL;

    vi.doMock("../../lib/push", () => ({
      dispatchNotification: async (input: { userId: string; vars?: Record<string, string> }) => {
        dispatched.push(input);
      },
    }));

    const { query } = await import("../../db");
    const { runBookingReminders } = await import("../../lib/reminders/bookings");
    const { emptyStats } = await import("../../lib/reminders/types");

    // A student in Accra, a mentor in Vancouver, one session.
    const [student] = await query<{ id: string }>(
      `INSERT INTO users (firebase_uid, email, full_name, role, preferred_language, timezone)
       VALUES ('tz-student', 'tz-student@example.com', 'Ama', 'student', 'en', 'Africa/Accra')
       ON CONFLICT (firebase_uid) DO UPDATE SET timezone = EXCLUDED.timezone
       RETURNING id`,
    );
    const [mentor] = await query<{ id: string }>(
      `INSERT INTO users (firebase_uid, email, full_name, role, preferred_language, timezone)
       VALUES ('tz-mentor', 'tz-mentor@example.com', 'Rita', 'mentor', 'en', 'America/Vancouver')
       ON CONFLICT (firebase_uid) DO UPDATE SET timezone = EXCLUDED.timezone
       RETURNING id`,
    );

    // Sits exactly one hour from "now" as far as the 1h lead time is concerned.
    const startsAt = new Date(Date.now() + 60 * 60 * 1000);
    const accraDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Accra",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(startsAt);
    const accraTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Accra",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(startsAt);

    await query(`DELETE FROM mentor_bookings WHERE student_id = $1`, [student.id]);
    await query(
      `INSERT INTO mentor_bookings
         (mentor_id, student_id, slot_date, slot_time, status, student_timezone, mentor_timezone)
       VALUES ($1, $2, $3::date, $4::time, 'confirmed', 'Africa/Accra', 'America/Vancouver')`,
      [mentor.id, student.id, accraDate, accraTime],
    );

    const stats = emptyStats();
    // A window wide enough to contain the booking regardless of clock skew.
    await runBookingReminders(
      new Date(Date.now() - 5 * 60 * 1000),
      new Date(Date.now() + 5 * 60 * 1000),
      stats,
    );

    expect(stats.errors).toBe(0);

    const student_ = dispatched.find((d) => d.userId === student.id);
    const mentor_ = dispatched.find((d) => d.userId === mentor.id);

    expect(student_, "student was not notified").toBeTruthy();
    expect(mentor_, "mentor was not notified").toBeTruthy();

    // Same moment, two clocks. Accra is UTC+0 and Vancouver is UTC-7 in
    // September, so the two renderings must differ — if they matched, the
    // mentor's zone was being ignored.
    expect(student_!.vars?.time).toBeTruthy();
    expect(mentor_!.vars?.time).toBeTruthy();
    expect(mentor_!.vars?.time).not.toBe(student_!.vars?.time);
  });
});
