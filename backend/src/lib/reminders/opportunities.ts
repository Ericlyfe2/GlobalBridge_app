import { query } from "../../db";
import { dispatchNotification } from "../push";
import { routes } from "../deep-links";
import { normalizeLocale } from "../i18n";
import { claimReminder, completeReminder } from "./store";
import { SAFE_TZ, formatCalendarDate } from "./time";
import type { PassStats } from "./types";

/**
 * Deadline reminders for saved opportunities.
 *
 * ── Who gets these ────────────────────────────────────────────────────────
 * Only users who saved the opportunity. Reminding everyone about every closing
 * scholarship would be a push notification per user per day, which trains
 * people to disable notifications — and the notification this product cannot
 * afford to have muted is the security alert. A save is the only signal we
 * have that someone actually cares about a particular deadline.
 *
 * ── When they fire ────────────────────────────────────────────────────────
 * Seven days out, and one day out. Seven is enough time to gather documents;
 * one is the last moment a same-day application is still possible.
 */
const LEAD_DAYS = [
  { fireKey: "7d", days: 7 },
  { fireKey: "1d", days: 1 },
] as const;

/**
 * Local hour at which a deadline reminder is delivered.
 *
 * A deadline is a calendar day, not an instant, so the send time is our choice
 * rather than the data's. 09:00 local is a working hour in every zone and — the
 * actual constraint — is never the middle of anyone's night. A naive
 * implementation that fires whenever the cron pass happens to run sends a
 * lock-screen alert at 3am to half the world.
 */
const SEND_AT_LOCAL_HOUR = 9;

type DeadlineRow = {
  opportunity_id: string;
  title: string;
  deadline: string;
  user_id: string;
  locale: string | null;
  timezone: string | null;
  fires_at: Date;
};

/**
 * Saved opportunities whose reminder instant falls in this pass's window.
 *
 * The instant is `deadline - N days` at 09:00 **in the recipient's zone**, which
 * is why this cannot be a simple date comparison: two users who saved the same
 * opportunity get the same reminder at two different absolute times, and both
 * are correct.
 */
async function dueDeadlines(windowStart: Date, windowEnd: Date, leadDays: number) {
  return query<DeadlineRow>(
    `SELECT o.id            AS opportunity_id,
            o.title,
            o.deadline::text AS deadline,
            u.id            AS user_id,
            u.preferred_language AS locale,
            u.timezone,
            ((o.deadline - ($3 || ' days')::interval + ($4 || ' hours')::interval)
              AT TIME ZONE ${SAFE_TZ("u.timezone")}) AS fires_at
       FROM saved_items s
       JOIN opportunities o ON o.id = s.item_id
       JOIN users u ON u.id = s.user_id
      WHERE s.item_type = 'opportunity'
        AND o.deadline IS NOT NULL
        AND o.deadline >= CURRENT_DATE
        AND ((o.deadline - ($3 || ' days')::interval + ($4 || ' hours')::interval)
              AT TIME ZONE ${SAFE_TZ("u.timezone")})
            BETWEEN $1::timestamptz AND $2::timestamptz`,
    [windowStart, windowEnd, String(leadDays), String(SEND_AT_LOCAL_HOUR)],
  );
}

export async function runOpportunityReminders(
  windowStart: Date,
  windowEnd: Date,
  stats: PassStats,
): Promise<void> {
  for (const lead of LEAD_DAYS) {
    let rows: DeadlineRow[];
    try {
      rows = await dueDeadlines(windowStart, windowEnd, lead.days);
    } catch (err) {
      console.error(`[reminders] deadline query (${lead.fireKey}) failed:`, (err as Error).message);
      stats.errors++;
      continue;
    }

    for (const row of rows) {
      if (!row.timezone) stats.missingTimezone++;

      const claim = await claimReminder({
        kind: "opportunity_deadline",
        subjectId: row.opportunity_id,
        userId: row.user_id,
        fireKey: lead.fireKey,
        dueAt: new Date(row.fires_at),
      });
      if (!claim) {
        stats.skippedAlreadySent++;
        continue;
      }

      const locale = normalizeLocale(row.locale);

      await dispatchNotification({
        userId: row.user_id,
        kind: "deadline",
        titleKey: "notification.deadline.title",
        bodyKey: "notification.deadline.body",
        vars: {
          title: row.title,
          // Formatted as a calendar date with no timezone conversion. Shifting
          // a deadline by a day because of a zone boundary is the one error
          // that would make this feature actively harmful.
          date: formatCalendarDate(row.deadline, locale),
        },
        deepLink: routes.opportunity(row.opportunity_id),
        data: { opportunityId: row.opportunity_id, deadline: row.deadline },
        // `deadline` is in the never-collapse set, so the 7-day and 1-day
        // reminders both get through regardless of any collapse key.
      });

      await completeReminder(claim);
      stats.sent++;
    }
  }
}
