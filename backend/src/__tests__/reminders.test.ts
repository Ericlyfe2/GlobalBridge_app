import "./setup-env";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The reminder scheduler.
 *
 * The claim protocol is exercised against a small in-memory stand-in for
 * `reminders_sent` that enforces the same unique constraint the migration
 * does — so "already sent" and "restart mid-pass" are real behaviour here, not
 * assertions about mock call counts.
 */

/** Mirrors lib/push's NotificationInput closely enough to assert against. */
type DispatchArg = {
  userId: string;
  kind: string;
  titleKey: string;
  bodyKey?: string;
  vars?: Record<string, string>;
  deepLink?: string;
  data?: Record<string, string>;
  collapseKey?: string;
};

const dispatchNotification = vi.fn<(input: DispatchArg) => Promise<void>>(async () => undefined);
vi.mock("../lib/push", () => ({ dispatchNotification }));

/** The single dispatch matching a predicate. Fails loudly rather than casting undefined. */
function dispatchTo(userId: string): DispatchArg {
  const call = dispatchNotification.mock.calls.find(([arg]) => arg.userId === userId);
  if (!call) throw new Error(`no notification dispatched to ${userId}`);
  return call[0];
}

function firstDispatch(): DispatchArg {
  const call = dispatchNotification.mock.calls[0];
  if (!call) throw new Error("no notification was dispatched");
  return call[0];
}

vi.mock("../lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken: vi.fn() },
  adminMessaging: { send: vi.fn() },
}));

// ── in-memory reminders_sent ────────────────────────────────────────────────

type ClaimRow = { id: string; status: "claimed" | "sent"; claimedAt: number };
let claims = new Map<string, ClaimRow>();
let claimSeq = 0;

/** Rows each source query returns. Set per test. */
let bookingRows: unknown[] = [];
let deadlineRows: unknown[] = [];
let checklistRows: unknown[] = [];

/** Sources made to fail, to check isolation between them. */
let failingSources = new Set<string>();

function handle(sql: string, params: unknown[] = []): unknown[] {
  if (sql.includes("INSERT INTO reminders_sent")) {
    const [kind, subjectId, userId, fireKey, , graceCutoff] = params as [
      string,
      string,
      string,
      string,
      unknown,
      Date,
    ];
    const key = `${kind}|${subjectId}|${userId}|${fireKey}`;
    const existing = claims.get(key);

    if (!existing) {
      const row: ClaimRow = { id: `claim-${++claimSeq}`, status: "claimed", claimedAt: Date.now() };
      claims.set(key, row);
      return [{ id: row.id }];
    }

    // The ON CONFLICT ... WHERE clause: only a stuck claim may be retaken.
    if (existing.status === "claimed" && existing.claimedAt < new Date(graceCutoff).getTime()) {
      existing.claimedAt = Date.now();
      return [{ id: existing.id }];
    }
    return [];
  }

  if (sql.includes("UPDATE reminders_sent SET status = 'sent'")) {
    const [id] = params as [string];
    for (const row of claims.values()) {
      if (row.id === id) row.status = "sent";
    }
    return [];
  }

  if (sql.includes("FROM mentor_bookings")) {
    if (failingSources.has("bookings")) throw new Error("bookings table locked");
    return bookingRows;
  }
  if (sql.includes("FROM saved_items")) {
    if (failingSources.has("opportunities")) throw new Error("saved_items unavailable");
    return deadlineRows;
  }
  if (sql.includes("FROM visa_checklists")) {
    if (failingSources.has("checklists")) throw new Error("checklists unavailable");
    return checklistRows;
  }

  return [];
}

const queryMock = vi.fn(async (sql: string, params?: unknown[]) => handle(sql, params));
const queryOneMock = vi.fn(async (sql: string, params?: unknown[]) => handle(sql, params)[0] ?? null);

vi.mock("../db", () => ({
  pool: { connect: vi.fn(), end: vi.fn(), on: vi.fn() },
  redis: null,
  query: (sql: string, params?: unknown[]) => queryMock(sql, params),
  queryOne: (sql: string, params?: unknown[]) => queryOneMock(sql, params),
  withTransaction: vi.fn(),
}));

// ── fixtures ────────────────────────────────────────────────────────────────

const STUDENT = "aaaaaaaa-0000-4000-8000-000000000001";
const MENTOR = "bbbbbbbb-0000-4000-8000-000000000002";
const BOOKING = "cccccccc-0000-4000-8000-000000000003";

/** 15:00 in Accra (UTC+0) on 14 September — the same instant is 08:00 in Vancouver. */
const SESSION_INSTANT = new Date("2026-09-14T15:00:00Z");

function bookingFixture(overrides: Record<string, unknown> = {}) {
  return {
    booking_id: BOOKING,
    starts_at: SESSION_INSTANT,
    goal: "Study permit questions",
    student_id: STUDENT,
    student_name: "Ama",
    student_locale: "en",
    student_tz: "Africa/Accra",
    mentor_id: MENTOR,
    mentor_name: "Rita",
    mentor_locale: "en",
    mentor_tz: "America/Vancouver",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  claims = new Map();
  claimSeq = 0;
  bookingRows = [];
  deadlineRows = [];
  checklistRows = [];
  failingSources = new Set();
});

// ── timezone rendering ──────────────────────────────────────────────────────

describe("timezone handling", () => {
  it("renders one instant on each participant's own clock", async () => {
    const { formatTimeFor } = await import("../lib/reminders/time");

    // The load-bearing property: one booking, one instant, two wall-clock
    // readings. A scheduler that computes two instants would have the pair
    // showing up eight hours apart.
    expect(formatTimeFor(SESSION_INSTANT, "Africa/Accra", "en")).toMatch(/3:00\s?PM/);
    expect(formatTimeFor(SESSION_INSTANT, "America/Vancouver", "en")).toMatch(/8:00\s?AM/);
  });

  it("falls back to UTC for an unusable timezone instead of throwing", async () => {
    const { formatTimeFor, safeTimezone, isValidTimezone } = await import("../lib/reminders/time");

    // An exception here would abort the whole pass over one bad profile row.
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(safeTimezone("Mars/Olympus")).toBe("UTC");
    expect(safeTimezone(null)).toBe("UTC");
    expect(() => formatTimeFor(SESSION_INSTANT, "Mars/Olympus", "en")).not.toThrow();
  });

  it("localises the rendered time", async () => {
    const { formatDateFor } = await import("../lib/reminders/time");
    const fr = formatDateFor(SESSION_INSTANT, "Europe/Paris", "fr");
    expect(fr).toMatch(/septembre/i);
  });

  it("never shifts a calendar deadline across a day boundary", async () => {
    const { formatCalendarDate } = await import("../lib/reminders/time");

    // A deadline stored as a DATE is a calendar day, not a moment. Telling a
    // user in Auckland their deadline is the 31st when the form says the 1st
    // is the one error that makes this feature actively harmful.
    // Asserted by component rather than by string, because the day/month order
    // is the formatter's business and the day *number* is ours. The failure
    // this guards is a date landing on the wrong day, not the wrong layout.
    const sep1 = formatCalendarDate("2026-09-01", "en");
    expect(sep1).toContain("September");
    expect(sep1).toMatch(/(^|[^0-9])1([^0-9]|$)/);
    expect(sep1).not.toMatch(/August|31/);

    // New Year's Day and New Year's Eve are where an off-by-one hour would
    // also move the year.
    const jan1 = formatCalendarDate("2026-01-01", "en");
    expect(jan1).toContain("January");
    expect(jan1).toContain("2026");
    expect(jan1).not.toMatch(/December|2025/);

    const dec31 = formatCalendarDate("2026-12-31", "en");
    expect(dec31).toContain("December");
    expect(dec31).toMatch(/(^|[^0-9])31([^0-9]|$)/);
    expect(dec31).not.toMatch(/January|2027/);
  });

  it("resolves the booking instant from the student's zone, not the mentor's", async () => {
    // The conversion itself happens in SQL. What is checked here is that the
    // statement reaches for student_timezone and only falls back to the
    // student's profile — using mentor_timezone to build the instant would
    // produce two different moments for one session.
    bookingRows = [bookingFixture()];
    const { runReminderPass } = await import("../lib/reminders");
    await runReminderPass({ now: new Date() });

    const bookingSql = queryMock.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes("FROM mentor_bookings"))!;

    expect(bookingSql).toContain("COALESCE(b.student_timezone, su.timezone)");
    expect(bookingSql).not.toContain("AT TIME ZONE COALESCE(b.mentor_timezone");
  });
});

// ── booking reminders ───────────────────────────────────────────────────────

describe("booking reminders", () => {
  it("notifies both participants", async () => {
    bookingRows = [bookingFixture()];
    const { runReminderPass } = await import("../lib/reminders");
    const stats = await runReminderPass({ now: new Date() });

    const recipients = dispatchNotification.mock.calls.map(([arg]) => arg.userId);
    expect(recipients).toContain(STUDENT);
    expect(recipients).toContain(MENTOR);
    expect(stats.sent).toBeGreaterThan(0);
  });

  it("tells each participant the time on their own clock", async () => {
    bookingRows = [bookingFixture()];
    const { runReminderPass } = await import("../lib/reminders");
    await runReminderPass({ now: new Date() });

    const forStudent = dispatchTo(STUDENT);
    const forMentor = dispatchTo(MENTOR);

    expect(forStudent.vars!.time).toMatch(/3:00\s?PM/);
    expect(forMentor.vars!.time).toMatch(/8:00\s?AM/);
    // And each is told who they are meeting, not their own name.
    expect(forStudent.vars!.name).toBe("Rita");
    expect(forMentor.vars!.name).toBe("Ama");
  });

  it("sends the 24h and 1h reminders as separate notifications", async () => {
    // Both lead times select the same booking here. They must not collapse
    // into one: the hour-before reminder is the one that gets people to show up.
    bookingRows = [bookingFixture()];
    const { runReminderPass } = await import("../lib/reminders");
    await runReminderPass({ now: new Date() });

    // 2 participants x 2 lead times
    expect(dispatchNotification).toHaveBeenCalledTimes(4);
    for (const [arg] of dispatchNotification.mock.calls) {
      expect(arg.collapseKey).toBeUndefined();
    }
  });

  it("counts a booking with no timezone rather than hiding it", async () => {
    bookingRows = [bookingFixture({ student_tz: null })];
    const { runReminderPass } = await import("../lib/reminders");
    const stats = await runReminderPass({ now: new Date() });

    expect(stats.missingTimezone).toBeGreaterThan(0);
    // Still sent: firing at a possibly-wrong hour beats never firing.
    expect(stats.sent).toBeGreaterThan(0);
  });

  it("deep-links to the booking", async () => {
    bookingRows = [bookingFixture()];
    const { runReminderPass } = await import("../lib/reminders");
    await runReminderPass({ now: new Date() });

    expect(firstDispatch().deepLink).toBe(`/bookings/${BOOKING}`);
  });
});

// ── idempotency ─────────────────────────────────────────────────────────────

describe("idempotency", () => {
  it("does not re-send on a second pass", async () => {
    bookingRows = [bookingFixture()];
    const { runReminderPass } = await import("../lib/reminders");

    const first = await runReminderPass({ now: new Date() });
    dispatchNotification.mockClear();
    const second = await runReminderPass({ now: new Date() });

    expect(first.sent).toBe(4);
    expect(second.sent).toBe(0);
    expect(second.skippedAlreadySent).toBe(4);
    expect(dispatchNotification).not.toHaveBeenCalled();
  });

  it("survives a restart mid-pass without re-sending what already went out", async () => {
    // The scenario §6 asks for: the process dies partway through a pass.
    bookingRows = [bookingFixture()];

    const { runReminderPass } = await import("../lib/reminders");

    // Crash on the third dispatch of four.
    let dispatched = 0;
    dispatchNotification.mockImplementation(async () => {
      if (++dispatched === 3) throw new Error("process died");
      return undefined;
    });

    await runReminderPass({ now: new Date() }).catch(() => undefined);
    const sentBeforeCrash = dispatched;
    expect(sentBeforeCrash).toBe(3);

    // Reboot: same fixtures, fresh pass, ledger intact.
    dispatchNotification.mockReset();
    dispatchNotification.mockImplementation(async () => undefined);

    const afterRestart = await runReminderPass({ now: new Date() });

    // The two that completed before the crash are not repeated. What is
    // re-attempted is only the remainder — never the whole batch.
    expect(afterRestart.sent).toBeLessThan(4);
    const resentRecipients = dispatchNotification.mock.calls.length;
    expect(resentRecipients).toBeLessThanOrEqual(2);
  });

  it("lets a second instance race without duplicating", async () => {
    // Two passes running concurrently is what an in-process cron on two
    // instances produces. Exactly one claim wins per reminder.
    bookingRows = [bookingFixture()];
    const { runReminderPass } = await import("../lib/reminders");

    const [a, b] = await Promise.all([
      runReminderPass({ now: new Date() }),
      runReminderPass({ now: new Date() }),
    ]);

    expect(a.sent + b.sent).toBe(4);
    expect(dispatchNotification).toHaveBeenCalledTimes(4);
  });
});

// ── deadline reminders ──────────────────────────────────────────────────────

describe("opportunity deadline reminders", () => {
  const OPPORTUNITY = "dddddddd-0000-4000-8000-000000000004";

  it("notifies the user who saved it, with the deadline as a calendar date", async () => {
    deadlineRows = [
      {
        opportunity_id: OPPORTUNITY,
        title: "Commonwealth Scholarship",
        deadline: "2026-09-01",
        user_id: STUDENT,
        locale: "en",
        timezone: "Africa/Accra",
        fires_at: new Date("2026-08-25T09:00:00Z"),
      },
    ];
    const { runReminderPass } = await import("../lib/reminders");
    await runReminderPass({ now: new Date() });

    const call = firstDispatch();
    expect(call.kind).toBe("deadline");
    expect(call.vars!.title).toBe("Commonwealth Scholarship");
    expect(call.vars!.date).toContain("September");
    expect(call.vars!.date).toContain("2026");
    expect(call.vars!.date).not.toMatch(/August|31/);
    expect(call.deepLink).toBe(`/opportunities/${OPPORTUNITY}`);
  });

  it("only considers saved opportunities", async () => {
    const { runReminderPass } = await import("../lib/reminders");
    await runReminderPass({ now: new Date() });

    const sql = queryMock.mock.calls.map(([s]) => s).find((s) => s.includes("FROM saved_items"))!;
    // Reminding everyone about every closing scholarship trains people to
    // disable notifications, and the one that must never be muted is the
    // security alert.
    expect(sql).toContain("s.item_type = 'opportunity'");
  });

  it("schedules against the recipient's local morning", async () => {
    const { runReminderPass } = await import("../lib/reminders");
    await runReminderPass({ now: new Date() });

    const sql = queryMock.mock.calls.map(([s]) => s).find((s) => s.includes("FROM saved_items"))!;
    // A deadline is a calendar day, so the send hour is our choice. Firing
    // whenever the cron pass lands would push a lock-screen alert at 3am.
    expect(sql).toContain("hours')::interval");
    expect(sql).toContain("AT TIME ZONE");
  });
});

// ── checklist nudges ────────────────────────────────────────────────────────

describe("checklist nudges", () => {
  const CHECKLIST = "eeeeeeee-0000-4000-8000-000000000005";

  it("nudges without claiming anything is due", async () => {
    checklistRows = [
      {
        checklist_id: CHECKLIST,
        user_id: STUDENT,
        destination_country: "Canada",
        total_items: 6,
        completed_items: 2,
      },
    ];
    const { runReminderPass } = await import("../lib/reminders");
    await runReminderPass({ now: new Date() });

    const call = firstDispatch();
    // `info`, not `deadline`. The roadmap phases carry a relative timeframe
    // ("Weeks 1-3") and no due date; categorising this as a deadline would give
    // it never-collapse priority and dilute the category real deadlines use.
    expect(call.kind).toBe("info");
    expect(call.vars!.remaining).toBe("4");
    expect(call.vars!.destination).toBe("Canada");
  });

  it("nudges once per checklist, never repeatedly", async () => {
    checklistRows = [
      {
        checklist_id: CHECKLIST,
        user_id: STUDENT,
        destination_country: "Canada",
        total_items: 6,
        completed_items: 2,
      },
    ];
    const { runReminderPass } = await import("../lib/reminders");

    await runReminderPass({ now: new Date() });
    dispatchNotification.mockClear();
    await runReminderPass({ now: new Date() });

    expect(dispatchNotification).not.toHaveBeenCalled();
  });

  it("ignores a finished checklist", async () => {
    const { runReminderPass } = await import("../lib/reminders");
    await runReminderPass({ now: new Date() });

    const sql = queryMock.mock.calls
      .map(([s]) => s)
      .find((s) => s.includes("FROM visa_checklists"))!;
    expect(sql).toContain("< jsonb_array_length(c.items)");
  });
});

// ── failure isolation ───────────────────────────────────────────────────────

describe("failure isolation", () => {
  it("keeps running the other sources when one query fails", async () => {
    failingSources.add("bookings");
    deadlineRows = [
      {
        opportunity_id: "dddddddd-0000-4000-8000-000000000004",
        title: "Chevening",
        deadline: "2026-11-05",
        user_id: STUDENT,
        locale: "en",
        timezone: "Africa/Accra",
        fires_at: new Date(),
      },
    ];

    const { runReminderPass } = await import("../lib/reminders");
    const stats = await runReminderPass({ now: new Date() });

    // A scheduler that aborts the whole pass because one table is locked is
    // how every reminder goes missing at once.
    expect(stats.errors).toBeGreaterThan(0);
    // The deadline source still ran. Two sends because the fixture is returned
    // for both the 7-day and the 1-day lead.
    expect(stats.sent).toBe(2);
  });

  it("reports a clean pass with nothing due", async () => {
    const { runReminderPass } = await import("../lib/reminders");
    const stats = await runReminderPass({ now: new Date() });
    expect(stats).toMatchObject({ sent: 0, errors: 0 });
  });
});

// ── catch-up window ─────────────────────────────────────────────────────────

describe("catch-up window", () => {
  it("looks back far enough to survive a deploy", async () => {
    const { CATCH_UP_WINDOW_MS } = await import("../lib/reminders");
    // Long enough for a realistic outage, short enough that nothing delivered
    // is actively misleading ("starts in 1 hour" for a session that ended).
    expect(CATCH_UP_WINDOW_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(CATCH_UP_WINDOW_MS).toBeLessThanOrEqual(12 * 60 * 60 * 1000);
  });

  it("passes a bounded window to the queries", async () => {
    const now = new Date("2026-09-14T12:00:00Z");
    const { runReminderPass, CATCH_UP_WINDOW_MS } = await import("../lib/reminders");
    await runReminderPass({ now });

    const call = queryMock.mock.calls.find(([sql]) => sql.includes("FROM mentor_bookings"))!;
    const [windowStart, windowEnd] = call[1] as [Date, Date];

    expect(windowEnd.getTime()).toBe(now.getTime());
    expect(now.getTime() - windowStart.getTime()).toBe(CATCH_UP_WINDOW_MS);
  });
});
