/**
 * Timezone handling for reminders.
 *
 * ── The trap, stated once ─────────────────────────────────────────────────
 * `mentor_bookings.slot_date` is a DATE and `slot_time` is a TIME. Neither
 * carries a zone. "2026-09-14, 15:00" is not an instant — it is a wall-clock
 * reading that means six different moments depending on who is holding the
 * clock. A reminder job that treats it as UTC, or as the server's local time,
 * fires at the wrong hour for almost everyone: a student in Accra and a mentor
 * in Vancouver share one booking row and are eight hours apart.
 *
 * `student_timezone` exists to resolve that ambiguity, and this module is where
 * the resolution happens.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * A booking has exactly ONE absolute instant. It is derived from the stored
 * wall-clock reading interpreted in the **student's** zone, because the student
 * is who booked the slot and whose clock the time was written from.
 *
 * `mentor_timezone` is NOT used to compute a second instant. There is no second
 * instant. It is used only to *render* that one instant on the mentor's clock,
 * so their reminder says "starts at 8:00 AM" rather than "starts at 4:00 PM"
 * for the same moment. Getting this backwards would produce two reminders for
 * two different moments and one of the pair would show up alone.
 */

/**
 * SQL fragment that turns a possibly-invalid timezone name into a usable one.
 *
 * Postgres raises on `AT TIME ZONE 'Mars/Olympus'`, and these strings come from
 * client input. An exception here would abort the whole reminder pass over one
 * bad profile row, so an unrecognised zone degrades to UTC instead. It is
 * checked against `pg_timezone_names` — the same list the conversion itself
 * uses, so anything that passes this check is guaranteed to convert.
 *
 * `$TZ$` is substituted with the expression producing the candidate name.
 */
export const SAFE_TZ = (expr: string): string =>
  `COALESCE((SELECT z.name FROM pg_timezone_names z WHERE z.name = ${expr} LIMIT 1), 'UTC')`;

/**
 * Is this a timezone Node can format in?
 *
 * Used on the rendering side, where an invalid zone would throw inside
 * Intl.DateTimeFormat. The Postgres side has its own check above; both exist
 * because the two libraries have overlapping but not identical zone databases.
 */
export function isValidTimezone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function safeTimezone(tz: string | null | undefined): string {
  return isValidTimezone(tz) ? tz! : "UTC";
}

/**
 * Render an instant on a specific person's clock, in their language.
 *
 * The whole point of a session reminder is the time in it, so this is not a
 * cosmetic detail — a reminder that says "3:00 PM" to someone for whom the
 * session is at 8:00 AM is worse than no reminder, because they will act on it.
 */
export function formatTimeFor(
  instant: Date,
  timezone: string | null | undefined,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: safeTimezone(timezone),
  }).format(instant);
}

export function formatDateFor(
  instant: Date,
  timezone: string | null | undefined,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: safeTimezone(timezone),
  }).format(instant);
}

/**
 * Format a bare calendar date — an opportunity deadline — without a timezone.
 *
 * Deliberately not converted to an instant first. A deadline stored as a DATE
 * is a calendar day, not a moment: "closes on 1 September" is the same claim in
 * every zone, and converting it to a timestamp would shift it a day either way
 * for users far enough east or west. The one thing that must not happen is
 * telling someone their deadline is the 31st when the form says the 1st.
 */
export function formatCalendarDate(date: string, locale: string): string {
  // The stored value is already a calendar date; parse it as UTC noon so the
  // formatter cannot shuffle it across a day boundary.
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}
