-- Up Migration
--
-- The reminder ledger.
--
-- This table is not bookkeeping that happens to be useful — it is the thing
-- that makes the scheduler safe to run at all. Two failure modes it prevents:
--
--   1. A restart mid-pass. Without a durable record of what has already gone
--      out, a process that dies after sending twenty of fifty reminders sends
--      those twenty again on boot.
--
--   2. A second instance. An in-process cron fires on every instance, so two
--      instances means two of every reminder. The unique constraint below turns
--      that from a correctness problem into a race that exactly one instance
--      wins — which is why this service can scale horizontally without moving
--      the scheduler to a separate worker first.
--
-- The claim is taken BEFORE the notification is dispatched, not after.

CREATE TABLE IF NOT EXISTS reminders_sent (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- What kind of thing is being reminded about.
    kind VARCHAR(32) NOT NULL,

    -- The row it concerns: an opportunity, a booking, a checklist.
    subject_id UUID NOT NULL,

    -- Who it goes to. A booking produces one row per participant, because the
    -- mentor and the student are reminded separately and either can fail alone.
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Which reminder in the sequence this is: "7d", "24h", "1h", "stale-14d".
    -- Part of the key, so "7 days before" and "1 day before" for the same
    -- deadline are two distinct reminders rather than one that fires twice.
    fire_key VARCHAR(32) NOT NULL,

    -- claimed -> sent. A row stuck in `claimed` is a pass that died between
    -- claiming and dispatching; the runner may re-claim it after a grace
    -- period rather than losing the reminder entirely.
    status VARCHAR(16) NOT NULL DEFAULT 'claimed',
    attempts INT NOT NULL DEFAULT 1,

    -- The instant the reminder was *for*, resolved into absolute time from the
    -- recipient's timezone. Kept so a wrong-hour delivery can be diagnosed
    -- afterwards without re-deriving the conversion.
    due_at TIMESTAMPTZ,

    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The idempotency key. Everything above depends on this existing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminders_sent_claim
    ON reminders_sent(kind, subject_id, user_id, fire_key);

-- Serves the stuck-claim sweep.
CREATE INDEX IF NOT EXISTS idx_reminders_sent_status
    ON reminders_sent(status, claimed_at)
    WHERE status = 'claimed';

-- Activity timestamp for visa_checklists.
--
-- The table only ever had created_at, so "has this person touched their
-- checklist recently" was unanswerable — which is what the staleness nudge
-- needs. Backfilled to created_at, which is accurate for every existing row:
-- with no write path maintaining it, creation *was* the last activity.
ALTER TABLE visa_checklists ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE visa_checklists SET updated_at = created_at WHERE updated_at IS NULL;

-- Down Migration
DROP TABLE IF EXISTS reminders_sent;
-- updated_at is left in place: dropping it would lose activity history that
-- accumulated while it existed, to undo an additive change that harms nothing.
