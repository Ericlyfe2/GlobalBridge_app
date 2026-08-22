/**
 * What one reminder pass did.
 *
 * Logged at the end of every pass. A scheduler that runs silently is a
 * scheduler nobody notices has stopped — and the failure mode of a reminder
 * system is silence, which is indistinguishable from "nothing was due".
 */
export type PassStats = {
  sent: number;
  /** Claimed by another pass or another instance — the normal, healthy case. */
  skippedAlreadySent: number;
  /** Past the catch-up window: too late to be useful, deliberately dropped. */
  skippedStale: number;
  /** Fired against a fallback timezone because the row had none. */
  missingTimezone: number;
  errors: number;
};

export function emptyStats(): PassStats {
  return {
    sent: 0,
    skippedAlreadySent: 0,
    skippedStale: 0,
    missingTimezone: 0,
    errors: 0,
  };
}
