import { query } from "../../db";
import { dispatchNotification } from "../push";
import { routes } from "../deep-links";
import { normalizeLocale } from "../i18n";
import { claimReminder, completeReminder } from "./store";
import { SAFE_TZ, formatTimeFor } from "./time";
import type { PassStats } from "./types";

/**
 * Mentor session reminders.
 *
 * Two per booking per participant: one a day ahead so they can rearrange their
 * day, one an hour ahead so they actually show up.
 */
const LEAD_TIMES = [
  { fireKey: "24h", minutes: 24 * 60 },
  { fireKey: "1h", minutes: 60 },
] as const;

type BookingRow = {
  booking_id: string;
  /** The one absolute instant, resolved from the student's wall clock. */
  starts_at: Date;
  goal: string | null;
  student_id: string;
  student_name: string;
  student_locale: string | null;
  student_tz: string | null;
  mentor_id: string;
  mentor_name: string;
  mentor_locale: string | null;
  mentor_tz: string | null;
};

/**
 * Bookings starting inside the window this pass is responsible for.
 *
 * The instant is computed in SQL rather than in Node so the conversion happens
 * once, against Postgres's own timezone database, in the same statement that
 * does the filtering — which means the WHERE clause and the value carried into
 * the notification can never disagree about what time the session is.
 *
 * `student_timezone` falls back to the student's profile timezone, then UTC.
 * A booking made before that column existed has neither, and firing at the
 * wrong hour is still better than never firing — but the fallback is counted so
 * it does not stay invisible.
 */
async function dueBookings(windowStart: Date, windowEnd: Date, leadMinutes: number) {
  return query<BookingRow>(
    `SELECT b.id                             AS booking_id,
            (b.slot_date + b.slot_time)
              AT TIME ZONE ${SAFE_TZ("COALESCE(b.student_timezone, su.timezone)")} AS starts_at,
            b.goal,
            su.id                            AS student_id,
            su.full_name                     AS student_name,
            su.preferred_language            AS student_locale,
            COALESCE(b.student_timezone, su.timezone) AS student_tz,
            mu.id                            AS mentor_id,
            mu.full_name                     AS mentor_name,
            mu.preferred_language            AS mentor_locale,
            COALESCE(b.mentor_timezone, mu.timezone)  AS mentor_tz
       FROM mentor_bookings b
       JOIN users su ON su.id = b.student_id
       JOIN users mu ON mu.id = b.mentor_id
      WHERE b.status IN ('pending', 'confirmed')
        AND (b.slot_date + b.slot_time)
              AT TIME ZONE ${SAFE_TZ("COALESCE(b.student_timezone, su.timezone)")}
            BETWEEN $1::timestamptz + ($3 || ' minutes')::interval
                AND $2::timestamptz + ($3 || ' minutes')::interval`,
    [windowStart, windowEnd, String(leadMinutes)],
  );
}

export async function runBookingReminders(
  windowStart: Date,
  windowEnd: Date,
  stats: PassStats,
): Promise<void> {
  for (const lead of LEAD_TIMES) {
    let bookings: BookingRow[];
    try {
      bookings = await dueBookings(windowStart, windowEnd, lead.minutes);
    } catch (err) {
      console.error(`[reminders] booking query (${lead.fireKey}) failed:`, (err as Error).message);
      stats.errors++;
      continue;
    }

    for (const booking of bookings) {
      const startsAt = new Date(booking.starts_at);

      // Both sides of the same booking, each rendered on their own clock. The
      // instant is identical; only the wall-clock reading differs.
      const recipients = [
        {
          userId: booking.student_id,
          otherName: booking.mentor_name,
          timezone: booking.student_tz,
          locale: normalizeLocale(booking.student_locale),
        },
        {
          userId: booking.mentor_id,
          otherName: booking.student_name,
          timezone: booking.mentor_tz,
          locale: normalizeLocale(booking.mentor_locale),
        },
      ];

      if (!booking.student_tz) stats.missingTimezone++;

      for (const recipient of recipients) {
        const claim = await claimReminder({
          kind: "booking_session",
          subjectId: booking.booking_id,
          userId: recipient.userId,
          // The lead time is part of the key, so "24h" and "1h" are two
          // reminders rather than one that fires twice.
          fireKey: lead.fireKey,
          dueAt: startsAt,
        });
        if (!claim) {
          stats.skippedAlreadySent++;
          continue;
        }

        await dispatchNotification({
          userId: recipient.userId,
          kind: "mentor",
          titleKey: "notification.booking.title",
          bodyKey: "notification.booking.body",
          vars: {
            name: recipient.otherName,
            time: formatTimeFor(startsAt, recipient.timezone, recipient.locale),
          },
          deepLink: routes.booking(booking.booking_id),
          data: { bookingId: booking.booking_id, startsAt: startsAt.toISOString() },
          // Deliberately no collapseKey. The 24h and the 1h reminder are
          // different messages about the same session and collapsing them would
          // drop the one that matters — the one an hour before.
        });

        await completeReminder(claim);
        stats.sent++;
      }
    }
  }
}
