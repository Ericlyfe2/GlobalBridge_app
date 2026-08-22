import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db";
import { requireAuth } from "../middleware/auth";
import { paginationSchema, listEnvelope, totalFromWindow } from "../lib/pagination";

export const contentRouter = Router();

/**
 * GET /content/notifications
 *
 * Two modes on one endpoint:
 *
 *   ?since=<ISO>  -- foreground reconcile. Everything newer than what the app
 *                    already holds, oldest first, so it can append.
 *   ?limit&offset -- the notification centre, newest first.
 *
 * The `since` mode exists for the same reason as GET /messages/since: a socket
 * that was closed while the app was suspended delivered nothing, and the app
 * has no way to know that from the socket alone.
 */
const listSchema = paginationSchema.extend({
  since: z.coerce.date().optional(),
  unread_only: z.coerce.boolean().default(false),
  kind: z
    .enum(["message", "deadline", "opportunity", "housing", "job", "mentor", "security", "document", "info"])
    .optional(),
});

contentRouter.get("/notifications", requireAuth, async (req, res, next) => {
  try {
    const p = listSchema.parse(req.query);
    const me = req.user!.sub;

    const filters = [`n.user_id = $1`];
    const values: unknown[] = [me];
    let i = 2;

    if (p.unread_only) filters.push(`n.read = FALSE`);
    if (p.kind) {
      filters.push(`n.kind = $${i++}`);
      values.push(p.kind);
    }

    if (p.since) {
      filters.push(`n.created_at > $${i++}`);
      values.push(p.since);

      const rows = await query(
        `SELECT n.id, n.kind, n.title, n.body, n.deep_link, n.data, n.read, n.locale, n.created_at
           FROM notifications n
          WHERE ${filters.join(" AND ")}
          ORDER BY n.created_at ASC, n.id ASC
          LIMIT $${i++}`,
        [...values, p.limit],
      );
      const last = rows[rows.length - 1] as { created_at: Date } | undefined;

      res.set("Cache-Control", "no-store");
      return res.json({
        items: rows,
        cursor: (last?.created_at ?? p.since).toISOString(),
        hasMore: rows.length === p.limit,
      });
    }

    const rows = await query<Record<string, unknown> & { total_count: string }>(
      `SELECT n.id, n.kind, n.title, n.body, n.deep_link, n.data, n.read, n.locale, n.created_at,
              COUNT(*) OVER() AS total_count
         FROM notifications n
        WHERE ${filters.join(" AND ")}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $${i++} OFFSET $${i++}`,
      [...values, p.limit, p.offset],
    );

    const total = totalFromWindow(rows);
    const items = rows.map(({ total_count, ...rest }) => rest);

    // Authenticated and per-user: never cached in any shared store.
    res.set("Cache-Control", "no-store");
    res.json(listEnvelope(items, total, { limit: p.limit, offset: p.offset }, "notifications"));
  } catch (err) {
    next(err);
  }
});

/** Badge count. Small enough to poll, so it is its own endpoint. */
contentRouter.get("/notifications/unread-count", requireAuth, async (req, res, next) => {
  try {
    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND read = FALSE`,
      [req.user!.sub],
    );
    res.set("Cache-Control", "no-store");
    res.json({ unread: Number(row?.count ?? 0) });
  } catch (err) {
    next(err);
  }
});

const markReadSchema = z.object({
  /** Absent means "mark everything read" -- the notification-centre gesture. */
  ids: z.array(z.string().uuid()).max(200).optional(),
});

contentRouter.post("/notifications/read", requireAuth, async (req, res, next) => {
  try {
    const { ids } = markReadSchema.parse(req.body ?? {});
    const me = req.user!.sub;

    // Always scoped by user_id as well as id: an id list arriving from a client
    // is not proof of ownership.
    const updated = ids?.length
      ? await query<{ id: string }>(
          `UPDATE notifications SET read = TRUE
            WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read = FALSE
            RETURNING id`,
          [me, ids],
        )
      : await query<{ id: string }>(
          `UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE RETURNING id`,
          [me],
        );

    res.set("Cache-Control", "no-store");
    res.json({ updated: updated.length });
  } catch (err) {
    next(err);
  }
});
