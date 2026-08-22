import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db";
import { requireAuth, isAdmin } from "../middleware/auth";
import { paginationSchema, listEnvelope, totalFromWindow } from "../lib/pagination";
import {
  MAX_UPLOAD_BYTES,
  PER_USER_QUOTA_BYTES,
  formatBytes,
} from "../lib/uploads/file-type";
import {
  storageConfigured,
  storageDescription,
  presignUpload,
  presignRead,
  quarantineKey,
  deleteObject,
  UPLOAD_URL_TTL_SECONDS,
  READ_URL_TTL_SECONDS,
} from "../lib/uploads/storage";
import { processUpload } from "../lib/uploads/process";

export const uploadsRouter = Router();

/**
 * Uploads.
 *
 *   POST /uploads/presign      -> a row in `pending` plus a URL to PUT to
 *   POST /uploads/:id/complete -> validate, strip, thumbnail, promote to `ready`
 *   GET  /uploads              -> the caller's documents
 *   GET  /uploads/:id          -> a short-lived signed read URL
 *   DELETE /uploads/:id
 *
 * The client never sends bytes here. It sends an intention, uploads directly to
 * the object store, and then tells us to check its work.
 */

/** Document categories, matching what the Document Checker understands. */
const DOC_TYPES = [
  "passport",
  "national_id",
  "visa",
  "bank_statement",
  "proof_of_funds",
  "transcript",
  "certificate",
  "acceptance_letter",
  "study_permit",
  "insurance",
  "accommodation",
  "employment",
  "other",
] as const;

/**
 * What the file is for, which decides who may read it.
 *
 * `document` is private to its owner and admins. `avatar` and `housing_photo`
 * are shown to other users — but still only through a signed URL, because
 * "visible to signed-in users" is not the same as "reachable by anyone with the
 * link forever".
 */
const PURPOSES = ["document", "avatar", "housing_photo"] as const;
type Purpose = (typeof PURPOSES)[number];

/** Content types the client may declare. The real check is on the bytes later. */
const DECLARABLE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

function storageUnavailable(res: import("express").Response) {
  // An explicit unavailable state rather than a broken upload screen. Without a
  // bucket there is nowhere durable to put an identity document, and accepting
  // one onto an ephemeral container filesystem is how passport scans disappear
  // on the next deploy.
  return res.status(503).json({
    error: "File uploads are not available right now.",
    code: "storage/not-configured",
  });
}

/** Bytes this account currently holds. Only `ready` rows count — see below. */
async function usedBytes(userId: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(size_bytes), 0)::text AS total
       FROM user_documents
      WHERE user_id = $1 AND status = 'ready'`,
    [userId],
  );
  return Number(row?.total ?? 0);
}

// ── presign ────────────────────────────────────────────────────────────────

const presignSchema = z.object({
  type: z.enum(DOC_TYPES).default("other"),
  purpose: z.enum(PURPOSES).default("document"),
  content_type: z.enum(DECLARABLE_TYPES),
  /** Used only to reject an obviously-oversized upload before issuing a URL. */
  size_bytes: z.coerce.number().int().min(1).max(MAX_UPLOAD_BYTES * 4),
  filename: z.string().max(255).optional(),
});

uploadsRouter.post("/presign", requireAuth, async (req, res, next) => {
  try {
    if (!storageConfigured) return storageUnavailable(res);

    const body = presignSchema.parse(req.body);
    const userId = req.user!.sub;

    if (body.size_bytes > MAX_UPLOAD_BYTES) {
      return res.status(413).json({
        error: `That file is ${formatBytes(body.size_bytes)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
        code: "upload/too-large",
        limit_bytes: MAX_UPLOAD_BYTES,
      });
    }

    // Checked against the *declared* size, which is a client claim — so this is
    // an early courtesy rejection, not the enforcement point. The real check
    // happens at completion against the measured size, where an over-quota
    // upload is deleted rather than kept.
    const used = await usedBytes(userId);
    if (used + body.size_bytes > PER_USER_QUOTA_BYTES) {
      return res.status(413).json({
        error:
          `You have used ${formatBytes(used)} of ${formatBytes(PER_USER_QUOTA_BYTES)}. ` +
          `Delete a file you no longer need to make room.`,
        code: "upload/quota-exceeded",
        used_bytes: used,
        quota_bytes: PER_USER_QUOTA_BYTES,
      });
    }

    const document = await queryOne<{ id: string }>(
      `INSERT INTO user_documents
         (user_id, type, purpose, status, mime_type, original_filename, file_name)
       VALUES ($1, $2, $3, 'pending', $4, $5, $5)
       RETURNING id`,
      [userId, body.type, body.purpose, body.content_type, body.filename ?? null],
    );
    if (!document) throw new Error("failed to create document row");

    const key = quarantineKey(userId, document.id);
    const uploadUrl = await presignUpload(key, body.content_type);

    res.set("Cache-Control", "no-store");
    res.status(201).json({
      document_id: document.id,
      upload_url: uploadUrl,
      // The client must send exactly this, because it is signed into the URL.
      method: "PUT",
      headers: { "Content-Type": body.content_type },
      expires_in: UPLOAD_URL_TTL_SECONDS,
      max_bytes: MAX_UPLOAD_BYTES,
    });
  } catch (err) {
    next(err);
  }
});

// ── complete ───────────────────────────────────────────────────────────────

const idSchema = z.object({ id: z.string().uuid() });

uploadsRouter.post("/:id/complete", requireAuth, async (req, res, next) => {
  try {
    if (!storageConfigured) return storageUnavailable(res);

    const { id } = idSchema.parse(req.params);
    const userId = req.user!.sub;

    // Scoped by user_id: a document id is not proof of ownership, and this
    // endpoint spends server resources fetching and re-encoding an object.
    const document = await queryOne<{
      id: string;
      status: string;
      purpose: Purpose;
      original_filename: string | null;
    }>(
      `SELECT id, status, purpose, original_filename
         FROM user_documents
        WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (!document) return res.status(404).json({ error: "Document not found" });

    if (document.status === "ready") {
      // Idempotent: a client that retried after a dropped response gets the
      // same answer rather than a second round of processing.
      return res.json({ document_id: id, status: "ready", already_processed: true });
    }
    if (document.status !== "pending") {
      return res.status(409).json({
        error: "That upload cannot be completed.",
        code: "upload/wrong-state",
        status: document.status,
      });
    }

    const result = await processUpload({
      quarantineKey: quarantineKey(userId, id),
      userId,
      purpose: document.purpose,
      originalFilename: document.original_filename ?? undefined,
    });

    if (!result.ok) {
      await query(
        `UPDATE user_documents
            SET status = 'rejected', rejected_reason = $2, processed_at = NOW()
          WHERE id = $1`,
        [id, result.reason],
      );
      res.set("Cache-Control", "no-store");
      return res.status(422).json({ error: result.reason, code: result.code, status: "rejected" });
    }

    // Quota, enforced against the measured size now that there is one.
    const used = await usedBytes(userId);
    if (used + result.sizeBytes > PER_USER_QUOTA_BYTES) {
      await deleteObject(result.storageKey);
      if (result.thumbnailKey) await deleteObject(result.thumbnailKey);
      await query(
        `UPDATE user_documents
            SET status = 'rejected', rejected_reason = 'Storage quota exceeded', processed_at = NOW()
          WHERE id = $1`,
        [id],
      );
      return res.status(413).json({
        error: `That file would put you over your ${formatBytes(PER_USER_QUOTA_BYTES)} limit.`,
        code: "upload/quota-exceeded",
      });
    }

    const updated = await queryOne(
      `UPDATE user_documents
          SET status = 'ready',
              storage_key = $2,
              thumbnail_key = $3,
              mime_type = $4,
              size_bytes = $5,
              checksum_sha256 = $6,
              processed_at = NOW()
        WHERE id = $1
      RETURNING id, type, purpose, status, mime_type, size_bytes, original_filename, created_at`,
      [
        id,
        result.storageKey,
        result.thumbnailKey,
        result.mimeType,
        result.sizeBytes,
        result.checksum,
      ],
    );

    res.set("Cache-Control", "no-store");
    res.json({
      document: updated,
      // Surfaced so the client can tell the user what was done to their file
      // rather than silently altering it. "We removed the location data from
      // this photo" is information they should have.
      metadata_stripped: result.strippedMetadata,
      transcoded: result.mimeType !== req.body?.content_type,
      dimensions: { width: result.width, height: result.height },
    });
  } catch (err) {
    next(err);
  }
});

// ── read ───────────────────────────────────────────────────────────────────

uploadsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const { limit, offset } = paginationSchema.parse(req.query);

    const rows = await query<Record<string, unknown> & { total_count: string }>(
      `SELECT id, type, purpose, status, mime_type, size_bytes, original_filename,
              verified, rejected_reason, created_at, processed_at,
              thumbnail_key IS NOT NULL AS has_thumbnail,
              COUNT(*) OVER() AS total_count
         FROM user_documents
        WHERE user_id = $1 AND status <> 'rejected'
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [req.user!.sub, limit, offset],
    );

    const total = totalFromWindow(rows);
    const items = rows.map(({ total_count, ...rest }) => rest);

    // Storage keys are never returned. A key is not a secret on its own, but
    // handing them out invites a client to construct URLs instead of asking for
    // one, which is where the authorization check lives.
    res.set("Cache-Control", "no-store");
    res.json(listEnvelope(items, total, { limit, offset }, "documents"));
  } catch (err) {
    next(err);
  }
});

/**
 * A short-lived signed URL for one document.
 *
 * This endpoint is the authorization boundary. The object store has no idea who
 * is asking — it honours any correctly signed URL — so the check has to happen
 * before the URL exists, and the URL has to expire quickly.
 */
uploadsRouter.get("/:id", requireAuth, async (req, res, next) => {
  try {
    if (!storageConfigured) return storageUnavailable(res);

    const { id } = idSchema.parse(req.params);
    const wantsThumbnail = req.query.thumbnail === "1" || req.query.thumbnail === "true";

    const document = await queryOne<{
      id: string;
      user_id: string;
      purpose: Purpose;
      status: string;
      storage_key: string | null;
      thumbnail_key: string | null;
      mime_type: string | null;
      original_filename: string | null;
    }>(
      `SELECT id, user_id, purpose, status, storage_key, thumbnail_key, mime_type, original_filename
         FROM user_documents
        WHERE id = $1`,
      [id],
    );

    if (!document || document.status !== "ready" || !document.storage_key) {
      return res.status(404).json({ error: "Document not found" });
    }

    const viewer = req.user!;
    const isOwner = document.user_id === viewer.sub;

    // A `document` is identity and financial paperwork: owner and admins only.
    // Anything else is shown to signed-in users, which is what makes an avatar
    // or a listing photo useful.
    const permitted = isOwner || isAdmin(viewer.role) || document.purpose !== "document";
    if (!permitted) {
      // 404 rather than 403 — a 403 confirms a document exists at this id and
      // that it belongs to someone else.
      return res.status(404).json({ error: "Document not found" });
    }

    const useThumb = wantsThumbnail && document.thumbnail_key;
    const url = await presignRead(
      useThumb ? document.thumbnail_key! : document.storage_key,
      useThumb ? "image/jpeg" : (document.mime_type ?? "application/octet-stream"),
      document.original_filename ?? undefined,
    );

    // Never cached anywhere shared: the URL is a bearer capability for someone's
    // passport scan, and a cached copy outlives the check that produced it.
    res.set("Cache-Control", "no-store");
    res.json({ url, expires_in: READ_URL_TTL_SECONDS });
  } catch (err) {
    next(err);
  }
});

// ── delete ─────────────────────────────────────────────────────────────────

uploadsRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = idSchema.parse(req.params);

    const document = await queryOne<{
      storage_key: string | null;
      thumbnail_key: string | null;
    }>(
      `SELECT storage_key, thumbnail_key FROM user_documents WHERE id = $1 AND user_id = $2`,
      [id, req.user!.sub],
    );
    if (!document) return res.status(404).json({ error: "Document not found" });

    // Row first, then objects. If object deletion fails the row is already gone,
    // which leaves an orphaned object — wasted bytes, and a sweep can find it.
    // The reverse order leaves a row pointing at nothing, which the app renders
    // as a broken document the user cannot get rid of.
    await query(`DELETE FROM user_documents WHERE id = $1 AND user_id = $2`, [id, req.user!.sub]);

    if (document.storage_key) await deleteObject(document.storage_key);
    if (document.thumbnail_key) await deleteObject(document.thumbnail_key);

    res.set("Cache-Control", "no-store");
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/** Whether the client should offer uploads at all, and the limits it must respect. */
uploadsRouter.get("/meta/status", requireAuth, async (req, res, next) => {
  try {
    const used = storageConfigured ? await usedBytes(req.user!.sub) : 0;
    res.set("Cache-Control", "no-store");
    res.json({
      available: storageConfigured,
      backend: storageDescription(),
      max_bytes: MAX_UPLOAD_BYTES,
      quota_bytes: PER_USER_QUOTA_BYTES,
      used_bytes: used,
      accepted_types: DECLARABLE_TYPES,
    });
  } catch (err) {
    next(err);
  }
});
