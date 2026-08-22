-- Up Migration
--
-- Native push registry (FCM, and APNs by way of FCM).
--
-- Separate from push_subscriptions rather than an extension of it: a web push
-- subscription is a three-part endpoint/p256dh/auth tuple issued by a browser
-- push service, an FCM registration is a single opaque token issued to an app
-- install. Forcing both into one table would mean nullable columns that are
-- required for one platform and meaningless for the other.

CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform VARCHAR(16) NOT NULL CHECK (platform IN ('ios', 'android')),
    app_version VARCHAR(32),
    -- Snapshot of the locale at registration time. Notification text is
    -- localised server-side, and the row that decides which language to send
    -- has to be the device's, not a stale profile default.
    locale VARCHAR(10) NOT NULL DEFAULT 'en',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

-- A phone that has been handed to someone else re-registers the same FCM token
-- under a new user_id. Looking up by token alone is how sign-out cleanup and
-- "who else claims this device" checks stay cheap.
CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON device_tokens(token);

-- Down Migration
DROP TABLE IF EXISTS device_tokens;
