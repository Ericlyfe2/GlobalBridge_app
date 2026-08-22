import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { paginationSchema, listEnvelope, totalFromWindow } from "../lib/pagination";
import { dispatchNotification } from "../lib/push";
import { routes } from "../lib/deep-links";
import { notifyUsers } from "../ws";

export const messagesRouter = Router();

/** Membership check. Every message route runs this before touching content. */
async function assertParticipant(conversationId: string, userId: string) {
  const row = await queryOne<{ participant_a: string; participant_b: string }>(
    `SELECT participant_a, participant_b FROM conversations WHERE id = $1`,
    [conversationId],
  );
  if (!row) throw new HttpError(404, "Conversation not found");
  if (row.participant_a !== userId && row.participant_b !== userId) {
    // 404 rather than 403: a 403 confirms that a conversation exists at this
    // id, which is itself information about two other people.
    throw new HttpError(404, "Conversation not found");
  }
  return row;
}

/** Conversation list. */
messagesRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const { limit, offset } = paginationSchema.parse(req.query);
    const me = req.user!.sub;

    const rows = await query<Record<string, unknown> & { total_count: string }>(
      `SELECT c.id, c.last_message_at, c.created_at,
              other.id   AS other_user_id,
              other.full_name AS other_user_name,
              other.avatar_url AS other_user_avatar,
              (SELECT body FROM messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT COUNT(*) FROM messages m
                WHERE m.conversation_id = c.id
                  AND m.sender_id <> $1
                  AND m.is_read = FALSE) AS unread_count,
              COUNT(*) OVER() AS total_count
         FROM conversations c
         JOIN users other
           ON other.id = CASE WHEN c.participant_a = $1 THEN c.participant_b ELSE c.participant_a END
        WHERE c.participant_a = $1 OR c.participant_b = $1
        ORDER BY c.last_message_at DESC, c.id DESC
        LIMIT $2 OFFSET $3`,
      [me, limit, offset],
    );

    const total = totalFromWindow(rows);
    const items = rows.map(({ total_count, ...rest }) => rest);

    res.set("Cache-Control", "no-store");
    res.json(listEnvelope(items, total, { limit, offset }, "conversations"));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /messages/since?cursor=<ISO timestamp>
 *
 * The missed-message replay, and the reason the app never shows a silent gap.
 *
 * A WebSocket that was down while the OS had the app suspended has no history:
 * reconnecting gets you everything from now on and nothing from the interval
 * you were away. The client cannot tell the difference between "nothing
 * happened" and "I missed it", so on foreground it asks for everything since
 * the last message it actually holds.
 *
 * The cursor is a timestamp rather than an id because the client's most recent
 * message is the only anchor it is guaranteed to have, and it knows when that
 * arrived. `(created_at, id)` breaks ties so two messages in the same
 * millisecond cannot straddle a page boundary and vanish.
 */
const sinceSchema = z.object({
  cursor: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

messagesRouter.get("/since", requireAuth, async (req, res, next) => {
  try {
    const { cursor, limit } = sinceSchema.parse(req.query);
    const me = req.user!.sub;

    // No cursor means a first sync, not "give me everything ever". An unbounded
    // backfill over a metered connection is a bill, not a feature.
    const since = cursor ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const rows = await query(
      `SELECT m.id, m.conversation_id, m.sender_id, m.body, m.is_read, m.created_at
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE (c.participant_a = $1 OR c.participant_b = $1)
          AND m.created_at > $2
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT $3`,
      [me, since, limit],
    );

    // The next cursor is the last row's timestamp, not "now": using the server
    // clock would skip anything written between the query and the response.
    const last = rows[rows.length - 1] as { created_at: Date } | undefined;

    res.set("Cache-Control", "no-store");
    res.json({
      items: rows,
      cursor: (last?.created_at ?? since).toISOString(),
      // A full page almost certainly means there is more; the client loops
      // until this is false rather than assuming one call reconciles.
      hasMore: rows.length === limit,
    });
  } catch (err) {
    next(err);
  }
});

/** Messages in one conversation, newest first. */
messagesRouter.get("/:conversationId", requireAuth, async (req, res, next) => {
  try {
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(req.params);
    const { limit, offset } = paginationSchema.parse(req.query);

    await assertParticipant(conversationId, req.user!.sub);

    const rows = await query<Record<string, unknown> & { total_count: string }>(
      `SELECT m.id, m.conversation_id, m.sender_id, m.body, m.is_read, m.created_at,
              COUNT(*) OVER() AS total_count
         FROM messages m
        WHERE m.conversation_id = $1
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset],
    );

    const total = totalFromWindow(rows);
    const items = rows.map(({ total_count, ...rest }) => rest);

    res.set("Cache-Control", "no-store");
    res.json(listEnvelope(items, total, { limit, offset }, "messages"));
  } catch (err) {
    next(err);
  }
});

const sendSchema = z.object({
  body: z.string().min(1).max(5000),
  /**
   * Client-generated idempotency key. An offline queue replaying on reconnect,
   * or a retry after a timeout the client could not distinguish from a failure,
   * must not produce two copies of the same message.
   */
  client_message_id: z.string().min(8).max(128).optional(),
});

messagesRouter.post("/:conversationId", requireAuth, async (req, res, next) => {
  try {
    const { conversationId } = z
      .object({ conversationId: z.string().uuid() })
      .parse(req.params);
    const body = sendSchema.parse(req.body);
    const me = req.user!.sub;

    const convo = await assertParticipant(conversationId, me);
    const recipient = convo.participant_a === me ? convo.participant_b : convo.participant_a;

    if (body.client_message_id) {
      // Deduplication window, not a permanent index: replays arrive seconds
      // apart, and a user legitimately sending the same text tomorrow is a new
      // message.
      const dup = await queryOne<{ id: string }>(
        `SELECT id FROM messages
          WHERE conversation_id = $1 AND sender_id = $2 AND body = $3
            AND created_at > NOW() - INTERVAL '5 minutes'
          LIMIT 1`,
        [conversationId, me, body.body],
      );
      if (dup) {
        res.set("Cache-Control", "no-store");
        return res.status(200).json({ message: dup, deduplicated: true });
      }
    }

    const message = await queryOne(
      `INSERT INTO messages (conversation_id, sender_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, conversation_id, sender_id, body, is_read, created_at`,
      [conversationId, me, body.body],
    );

    await query(`UPDATE conversations SET last_message_at = NOW() WHERE id = $1`, [conversationId]);

    const sender = await queryOne<{ full_name: string }>(
      `SELECT full_name FROM users WHERE id = $1`,
      [me],
    );

    // Live delivery to an open app, separate from the notification: an open
    // conversation should show the message inline, not raise a banner.
    await notifyUsers([recipient], {
      type: "message",
      conversationId,
      message,
    });

    await dispatchNotification({
      userId: recipient,
      kind: "message",
      titleKey: "notification.message.title",
      vars: { name: sender?.full_name ?? "Someone" },
      deepLink: routes.conversation(conversationId),
      data: { conversationId },
      // Ten messages in a row from one person is one notification, not ten.
      collapseKey: `message:${conversationId}`,
    });

    res.set("Cache-Control", "no-store");
    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});
