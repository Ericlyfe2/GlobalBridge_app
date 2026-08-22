-- Up Migration
--
-- Direct-to-storage uploads.
--
-- The existing shape assumed the API received the bytes: a row was written once,
-- complete, with a `url` pointing at something already stored. A pre-signed
-- upload inverts that — the row exists *before* the file does, and passes
-- through states while the client uploads and the server validates.
--
-- Hence `status`. A document is not servable until it reaches `ready`, which is
-- the only state in which its bytes have actually been checked.

-- The pre-signed flow has no URL to record at insert time, and for identity
-- documents there is never a permanent URL at all — every read is a fresh
-- short-lived signed URL. Existing rows and the web platform's writes are
-- unaffected.
ALTER TABLE user_documents ALTER COLUMN url DROP NOT NULL;

-- Object key in the bucket. Opaque and unguessable; never derived from a
-- user-supplied filename, which would otherwise let one user probe for
-- another's "passport.jpg".
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS thumbnail_key TEXT;

-- What the file is for, which decides who may read it. `document` is private to
-- its owner and admins; `avatar` and `housing_photo` are shown to other users.
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS purpose VARCHAR(32) NOT NULL DEFAULT 'document';

-- pending  -> a presign was issued, the client may be uploading
-- ready    -> bytes verified, metadata stripped, safe to serve
-- rejected -> failed validation; the object has been deleted
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'ready';
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

-- Actual stored size, measured server-side after upload. The client's declared
-- size is used only to reject an obviously-too-large request before issuing a
-- presign; it is never trusted for quota accounting.
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS checksum_sha256 CHAR(64);

ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255);
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- Existing rows predate this flow and are already stored and served, so they
-- are `ready` by definition -- which is what the column default gives them.
-- New rows are inserted explicitly as `pending`.

CREATE INDEX IF NOT EXISTS idx_user_documents_user_status
    ON user_documents(user_id, status, created_at DESC);

-- One row per object. Guards against a completion handler racing with itself
-- and pointing two rows at the same key, which would make deletion of one
-- silently break the other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_documents_storage_key
    ON user_documents(storage_key)
    WHERE storage_key IS NOT NULL;

-- Serves the per-user quota sum, which runs on every presign request.
CREATE INDEX IF NOT EXISTS idx_user_documents_quota
    ON user_documents(user_id)
    WHERE status = 'ready';

-- Down Migration
DROP INDEX IF EXISTS idx_user_documents_quota;
DROP INDEX IF EXISTS uq_user_documents_storage_key;
DROP INDEX IF EXISTS idx_user_documents_user_status;
ALTER TABLE user_documents DROP COLUMN IF EXISTS processed_at;
ALTER TABLE user_documents DROP COLUMN IF EXISTS original_filename;
ALTER TABLE user_documents DROP COLUMN IF EXISTS checksum_sha256;
ALTER TABLE user_documents DROP COLUMN IF EXISTS size_bytes;
ALTER TABLE user_documents DROP COLUMN IF EXISTS rejected_reason;
ALTER TABLE user_documents DROP COLUMN IF EXISTS status;
ALTER TABLE user_documents DROP COLUMN IF EXISTS purpose;
ALTER TABLE user_documents DROP COLUMN IF EXISTS thumbnail_key;
ALTER TABLE user_documents DROP COLUMN IF EXISTS storage_key;
-- url is deliberately left nullable: restoring NOT NULL would fail against any
-- row created by the pre-signed flow.
