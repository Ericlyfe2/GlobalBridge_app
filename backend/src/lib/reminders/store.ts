import { queryOne, query } from "../../db";

/**
 * Claiming and completing reminders.
 *
 * ── Claim before send, not after ──────────────────────────────────────────
 * The alternative — send, then record — loses the race with a second instance
 * and re-sends everything after a crash. Claiming first means the window in
 * which a duplicate is possible is zero, at the cost of a window in which a
 * reminder can be lost: a process that dies between claiming and dispatching
 * leaves a row that says "sent" for a notification nobody received.
 *
 * That is why `status` exists. A claim is provisional until it is marked
 * `sent`, and a claim left hanging longer than the grace period may be taken
 * again. So the guarantee is: **exactly once in the normal case, at-most-twice
 * only if a process dies inside a ten-minute window mid-dispatch.**
 *
 * The direction of the trade-off is deliberate. These are deadline and session
 * reminders; a user who misses one misses a visa appointment, and a user who
 * gets one twice is mildly annoyed.
 */

export type ReminderKind = "opportunity_deadline" | "booking_session" | "checklist_stale";

/** How long a claim may sit un-sent before another pass may take it over. */
const CLAIM_GRACE_MS = 10 * 60 * 1000;

export type ClaimInput = {
  kind: ReminderKind;
  subjectId: string;
  userId: string;
  /** Which reminder in the sequence: "7d", "24h", "1h", "stale-14d". */
  fireKey: string;
  /** The instant this reminder was for, in absolute time. */
  dueAt: Date | null;
};

/**
 * Take exclusive responsibility for sending one reminder.
 *
 * Returns the claim id if this caller won, or null if it was already claimed or
 * already sent. Null means "somebody else has this" — including a past run of
 * this same process — and the caller must not dispatch.
 *
 * The ON CONFLICT clause re-claims only rows that are stuck: still `claimed`,
 * and older than the grace period. A row that reached `sent` never matches, so
 * a delivered reminder can never be resurrected.
 */
export async function claimReminder(input: ClaimInput): Promise<string | null> {
  const graceCutoff = new Date(Date.now() - CLAIM_GRACE_MS);

  const row = await queryOne<{ id: string }>(
    `INSERT INTO reminders_sent (kind, subject_id, user_id, fire_key, due_at, status)
     VALUES ($1, $2, $3, $4, $5, 'claimed')
     ON CONFLICT (kind, subject_id, user_id, fire_key)
     DO UPDATE SET attempts = reminders_sent.attempts + 1,
                   claimed_at = NOW()
      WHERE reminders_sent.status = 'claimed'
        AND reminders_sent.claimed_at < $6
     RETURNING id`,
    [input.kind, input.subjectId, input.userId, input.fireKey, input.dueAt, graceCutoff],
  );

  return row?.id ?? null;
}

/** Mark a claimed reminder as delivered. */
export async function completeReminder(claimId: string): Promise<void> {
  try {
    await query(
      `UPDATE reminders_sent SET status = 'sent', sent_at = NOW() WHERE id = $1`,
      [claimId],
    );
  } catch (err) {
    // The notification has already gone out. Failing to record that is a
    // bookkeeping problem, and the worst case is one duplicate after the grace
    // period — far better than throwing here and aborting the rest of the pass.
    console.error("completeReminder failed:", (err as Error).message);
  }
}

/**
 * Release a claim that could not be dispatched.
 *
 * Used when the send fails for a reason worth retrying on the next pass rather
 * than waiting out the grace period.
 */
export async function releaseReminder(claimId: string): Promise<void> {
  try {
    await query(`DELETE FROM reminders_sent WHERE id = $1 AND status = 'claimed'`, [claimId]);
  } catch (err) {
    console.error("releaseReminder failed:", (err as Error).message);
  }
}
