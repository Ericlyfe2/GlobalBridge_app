-- Up Migration
--
-- What the mobile notification path needs on top of the existing row shape.

-- Deep-link target, as a canonical app path ("/messages/<id>"), kept separate
-- from the legacy `href` so the web platform's own links are untouched. Push
-- payloads and in-app taps both route from this.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deep_link TEXT;

-- Structured payload for the client (ids the deep link needs, counts, etc).
-- Never carries document contents or anything that would be unsafe in a push
-- payload, which is delivered by a third party and shown on a lock screen.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data JSONB;

-- Collapse key. Repeats of the same kind for the same subject fold into one
-- delivery. `security` and `deadline` never collapse -- see lib/push.ts.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS collapse_key TEXT;

-- The language the row was written in, so the app can tell a genuinely
-- untranslated notification from one that fell back to English.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS locale VARCHAR(10) NOT NULL DEFAULT 'en';

-- GET /api/v1/content/notifications?since= pages by (created_at, id). Without
-- this the reconcile-on-foreground call table-scans the whole user history.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications(user_id, created_at DESC, id DESC);

-- GET /api/v1/messages/since?cursor= is the missed-message replay. It filters
-- messages by created_at across every conversation the user is in, which the
-- per-conversation index cannot serve.
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC, id DESC);

-- Down Migration
DROP INDEX IF EXISTS idx_messages_created_at;
DROP INDEX IF EXISTS idx_notifications_user_created;
ALTER TABLE notifications DROP COLUMN IF EXISTS locale;
ALTER TABLE notifications DROP COLUMN IF EXISTS collapse_key;
ALTER TABLE notifications DROP COLUMN IF EXISTS data;
ALTER TABLE notifications DROP COLUMN IF EXISTS deep_link;
