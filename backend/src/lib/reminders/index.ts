import { emptyStats, type PassStats } from "./types";
import { runBookingReminders } from "./bookings";
import { runOpportunityReminders } from "./opportunities";
import { runChecklistReminders } from "./checklists";

export { emptyStats, type PassStats } from "./types";

/**
 * One reminder pass.
 *
 * ── The catch-up window, and why it is bounded ────────────────────────────
 * A pass does not look at "right now" — it looks at a window ending now and
 * starting some hours back. That is what makes a restart safe: a deploy, a
 * crash, or a two-hour outage does not silently swallow every reminder that
 * came due while the process was down. They fire late instead of never.
 *
 * But the window has a floor, and that matters just as much. A "your session
 * starts in one hour" notification delivered nine hours after the session is
 * not a late reminder, it is a false one — the user reads it, believes it, and
 * arrives for a meeting that already happened. Past the window, a reminder is
 * dropped and counted as stale rather than sent wrong.
 *
 * Six hours is the compromise: long enough to survive any realistic deploy or
 * incident, short enough that nothing delivered is actively misleading.
 */
export const CATCH_UP_WINDOW_MS = 6 * 60 * 60 * 1000;

export type PassOptions = {
  /** Overrides "now". Exists so tests can place the window deterministically. */
  now?: Date;
  windowMs?: number;
};

export async function runReminderPass(opts: PassOptions = {}): Promise<PassStats> {
  const now = opts.now ?? new Date();
  const windowMs = opts.windowMs ?? CATCH_UP_WINDOW_MS;
  const windowStart = new Date(now.getTime() - windowMs);

  const stats = emptyStats();
  const started = Date.now();

  // Each source is independent and failures are contained: a broken query in
  // one must not stop the other two from running. A scheduler that stops
  // entirely because one table is locked is how every reminder goes missing at
  // once.
  await runBookingReminders(windowStart, now, stats).catch((err) => {
    console.error("[reminders] bookings failed:", (err as Error).message);
    stats.errors++;
  });

  await runOpportunityReminders(windowStart, now, stats).catch((err) => {
    console.error("[reminders] opportunities failed:", (err as Error).message);
    stats.errors++;
  });

  await runChecklistReminders(now, stats).catch((err) => {
    console.error("[reminders] checklists failed:", (err as Error).message);
    stats.errors++;
  });

  const elapsed = Date.now() - started;

  // Always logged, including a pass that did nothing. The failure mode of a
  // reminder system is silence, and silence is indistinguishable from "nothing
  // was due" unless the quiet passes are visible too.
  console.log(
    `[reminders] pass complete in ${elapsed}ms — ` +
      `sent=${stats.sent} already=${stats.skippedAlreadySent} stale=${stats.skippedStale} ` +
      `no-tz=${stats.missingTimezone} errors=${stats.errors}`,
  );

  if (stats.missingTimezone > 0) {
    // Not an error, but it means those reminders fired on a fallback zone and
    // some of them will have landed at the wrong hour for the recipient.
    console.warn(
      `[reminders] ${stats.missingTimezone} reminder(s) had no timezone and used UTC — ` +
        `those may have been delivered at the wrong local hour`,
    );
  }

  return stats;
}
