import cron from "node-cron";
import { env } from "./env";
import { runReminderPass } from "./lib/reminders";

/**
 * The reminder scheduler.
 *
 * ── In-process, and why that is acceptable here ───────────────────────────
 * node-cron runs inside the API process. The usual objection is that N
 * instances means N firings of every job — and that objection is correct, but
 * it is answered in `reminders_sent` rather than here: every reminder is
 * claimed with a unique-constrained insert before it is dispatched, so
 * concurrent passes race and exactly one wins. Extra instances waste a few
 * queries; they do not send duplicates.
 *
 * That is the difference between "documented caveat" and "handled". A separate
 * worker process would still need the same claim logic to survive its own
 * restarts, so the claim is the load-bearing part and the process topology is
 * not.
 *
 * What in-process scheduling does still cost: passes only run while at least
 * one instance is up, and a long outage eats everything outside the catch-up
 * window. That is the real limitation, and it is the reason the window exists.
 *
 * ── Cadence ───────────────────────────────────────────────────────────────
 * Every 15 minutes. The tightest lead time is one hour before a session, so
 * quarter-hourly granularity puts a reminder between 45 and 60 minutes ahead —
 * comfortably inside "an hour before" without a cron entry per minute.
 */
const SCHEDULE = env.REMINDER_CRON || "*/15 * * * *";

let task: cron.ScheduledTask | null = null;
let running = false;

export function startScheduler(): void {
  if (!env.REMINDERS_ENABLED) {
    console.log("⏰ reminder scheduler disabled (REMINDERS_ENABLED is not set)");
    return;
  }

  if (!cron.validate(SCHEDULE)) {
    // Refuse to start rather than silently never firing. A typo'd cron
    // expression is otherwise indistinguishable from "no reminders were due",
    // which is the failure this whole subsystem is trying to avoid.
    console.error(`❌ REMINDER_CRON is not a valid cron expression: "${SCHEDULE}"`);
    return;
  }

  task = cron.schedule(SCHEDULE, () => {
    // Overlap guard. A pass that runs long — a large backlog after an outage —
    // must not have the next tick start on top of it. The claim logic would
    // keep that correct, but it would double the query load at exactly the
    // moment the database is already behind.
    if (running) {
      console.warn("[reminders] previous pass still running, skipping this tick");
      return;
    }
    running = true;
    void runReminderPass()
      .catch((err) => console.error("[reminders] pass threw:", (err as Error).message))
      .finally(() => {
        running = false;
      });
  });

  console.log(`⏰ reminder scheduler started (${SCHEDULE})`);
}

export function stopScheduler(): void {
  task?.stop();
  task = null;
}
