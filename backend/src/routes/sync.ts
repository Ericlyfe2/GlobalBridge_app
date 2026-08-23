import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";

export const syncRouter = Router();

/**
 * GET /sync?since= — deltas for the app's local cache.
 *
 * ── What may be cached, and what may not ──────────────────────────────────
 * Everything returned here is either the user's own reference data or content
 * they have already seen. Three things are deliberately absent and must stay
 * absent:
 *
 *   - **AI responses.** Guidance is generated against config and a knowledge
 *     base that change; a cached answer about a visa fee outlives its accuracy
 *     and there is no way for the client to know when.
 *   - **Documents.** Identity paperwork is served through short-lived signed
 *     URLs precisely so a copy does not persist somewhere unmanaged. Syncing it
 *     into a local database would undo that.
 *   - **Credentials.** Nothing token-shaped is ever part of a cacheable payload.
 *
 * On a native client the store is app-scoped rather than origin-scoped, so the
 * shared-browser leak does not apply — but a shared *phone* is not hypothetical
 * for this audience, and neither is a lost one. Hence the sign-out rule: the
 * local store is cleared completely, not invalidated.
 *
 * ── Deletions, which is the hard part ─────────────────────────────────────
 * A "changed since" query cannot report a row that no longer exists, so a
 * client that unsaves an opportunity on one device keeps it forever on another.
 * There are two honest answers and this endpoint uses both:
 *
 *   1. For `saved_items` — small, bounded, and where deletion is a normal daily
 *      action — the full authoritative id list is returned every time. The
 *      client reconciles by set difference. It costs a few hundred bytes and it
 *      is exactly correct.
 *   2. For everything else, deletion is rare or soft (conversations are not
 *      deleted, notifications are marked read rather than removed, checklists
 *      are replaced wholesale on regeneration). Those are covered by the
 *      full-resync rule below rather than by tombstones.
 *
 * A tombstone table would generalise this, and is the right answer if a
 * hard-delete path ever appears for messages or notifications. It is not built
 * because nothing currently produces those deletions.
 *
 * ── Why an old cursor forces a full resync ────────────────────────────────
 * Delta sync without tombstones degrades with time: the longer a client has
 * been away, the more likely something it holds was deleted in a way this
 * response cannot describe. Past the horizon the honest move is to tell the
 * client to start over rather than to hand it a delta that quietly leaves stale
 * rows behind.
 */

/** Beyond this, a delta cannot be trusted to describe what changed. */
const MAX_SYNC_AGE_DAYS = 30;

/** Per-collection ceiling. A sync response must fit on a metered connection. */
const COLLECTION_LIMIT = 200;

/** Authoritative id lists are only correct while they are complete. */
const MAX_SAVED_IDS = 1000;

const querySchema = z.object({
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(COLLECTION_LIMIT).default(100),
});

/** The newest timestamp across every returned row, or the cursor we started from. */
function nextCursor(fallback: Date, ...collections: { updated: string | Date }[][]): string {
  let newest = fallback.getTime();
  for (const rows of collections) {
    for (const row of rows) {
      const t = new Date(row.updated).getTime();
      if (Number.isFinite(t) && t > newest) newest = t;
    }
  }
  return new Date(newest).toISOString();
}

syncRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const { since, limit } = querySchema.parse(req.query);
    const userId = req.user!.sub;

    const horizon = new Date(Date.now() - MAX_SYNC_AGE_DAYS * 24 * 60 * 60 * 1000);

    // No cursor is a first sync, not "everything ever". An unbounded backfill
    // over a metered connection is a bill, not a feature.
    const fullResync = !since || since < horizon;
    const cursor = fullResync ? horizon : since;

    const [notifications, messages, conversations, checklists, savedChanged, savedIds] =
      await Promise.all([
        query<{ updated: string }>(
          `SELECT id, kind, title, body, deep_link, data, read, locale, created_at,
                  created_at AS updated
             FROM notifications
            WHERE user_id = $1 AND created_at > $2
            ORDER BY created_at ASC, id ASC
            LIMIT $3`,
          [userId, cursor, limit],
        ),

        query<{ updated: string }>(
          `SELECT m.id, m.conversation_id, m.sender_id, m.body, m.is_read, m.created_at,
                  m.created_at AS updated
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
            WHERE (c.participant_a = $1 OR c.participant_b = $1)
              AND m.created_at > $2
            ORDER BY m.created_at ASC, m.id ASC
            LIMIT $3`,
          [userId, cursor, limit],
        ),

        query<{ updated: string }>(
          `SELECT c.id, c.participant_a, c.participant_b, c.last_message_at, c.created_at,
                  c.last_message_at AS updated
             FROM conversations c
            WHERE (c.participant_a = $1 OR c.participant_b = $1)
              AND c.last_message_at > $2
            ORDER BY c.last_message_at ASC, c.id ASC
            LIMIT $3`,
          [userId, cursor, limit],
        ),

        // Checklist state is explicitly cacheable per the offline design: it is
        // the user's own progress and it is useful with no connection at all,
        // which is the point of ticking items off in an embassy queue.
        query<{ updated: string }>(
          `SELECT id, destination_country, visa_type, items, completed_items,
                  created_at, updated_at,
                  COALESCE(updated_at, created_at) AS updated
             FROM visa_checklists
            WHERE user_id = $1 AND COALESCE(updated_at, created_at) > $2
            ORDER BY COALESCE(updated_at, created_at) ASC, id ASC
            LIMIT $3`,
          [userId, cursor, limit],
        ),

        query<{ updated: string }>(
          `SELECT id, item_type, item_id, created_at, created_at AS updated
             FROM saved_items
            WHERE user_id = $1 AND created_at > $2
            ORDER BY created_at ASC, id ASC
            LIMIT $3`,
          [userId, cursor, limit],
        ),

        // The deletion answer for saved items. Complete, not paged -- a partial
        // list would make the client delete everything past the page boundary.
        query<{ id: string }>(
          `SELECT id FROM saved_items WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
          [userId, MAX_SAVED_IDS + 1],
        ),
      ]);

    // If the id list hit its ceiling it is no longer authoritative, and telling
    // the client to reconcile against a truncated list would delete real rows
    // from its cache.
    const savedIdsComplete = savedIds.length <= MAX_SAVED_IDS;

    const collections = {
      notifications,
      messages,
      conversations,
      checklists,
      saved_items: savedChanged,
    };

    // A full page almost certainly means there is more. The client loops on the
    // returned cursor rather than assuming one call reconciles everything.
    const hasMore = Object.values(collections).some((rows) => rows.length === limit);

    res.set("Cache-Control", "no-store");
    res.json({
      cursor: nextCursor(
        cursor,
        notifications,
        messages,
        conversations,
        checklists,
        savedChanged,
      ),
      has_more: hasMore,
      /**
       * The client must clear its local store before applying this response.
       * Set when there was no cursor, or when the cursor is older than the
       * horizon and the delta can no longer be trusted to describe deletions.
       */
      full_resync: fullResync,
      collections,
      /**
       * Authoritative when `complete` is true: any locally-held saved item whose
       * id is absent from this list has been removed elsewhere and should be
       * dropped. When false the list was truncated and the client must not
       * reconcile deletions from it.
       */
      saved_item_ids: {
        complete: savedIdsComplete,
        ids: savedIdsComplete ? savedIds.map((r) => r.id) : [],
      },
    });
  } catch (err) {
    next(err);
  }
});
