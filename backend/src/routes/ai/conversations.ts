import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../../db";
import { requireAuth } from "../../middleware/auth";
import { paginationSchema, listEnvelope, totalFromWindow } from "../../lib/pagination";

export const conversationsRouter = Router();

/**
 * Assistant history.
 *
 * Every handler here scopes by user_id in the SQL rather than checking
 * ownership after the fact. A conversation with an immigration assistant
 * contains someone's status, their family situation and their fears about it —
 * a missed ownership check is not a minor bug on this table.
 */

conversationsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const { limit, offset } = paginationSchema.parse(req.query);

    const rows = await query<Record<string, unknown> & { total_count: string }>(
      `SELECT id, title, origin_country, destination_country, visa_type,
              message_count, summary, topics, created_at, updated_at,
              COUNT(*) OVER() AS total_count
         FROM ai_conversations
        WHERE user_id = $1 AND is_active = true
        ORDER BY updated_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [req.user!.sub, limit, offset],
    );

    const total = totalFromWindow(rows);
    const items = rows.map(({ total_count, ...rest }) => rest);

    res.set("Cache-Control", "no-store");
    res.json(listEnvelope(items, total, { limit, offset }, "conversations"));
  } catch (err) {
    next(err);
  }
});

const idSchema = z.object({ id: z.string().uuid() });

conversationsRouter.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = idSchema.parse(req.params);

    const conversation = await queryOne(
      `SELECT id, title, origin_country, destination_country, visa_type,
              message_count, summary, topics, created_at, updated_at
         FROM ai_conversations
        WHERE id = $1 AND user_id = $2`,
      [id, req.user!.sub],
    );
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const messages = await query(
      `SELECT id, role, content, sources, created_at
         FROM ai_messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC, id ASC`,
      [id],
    );

    res.set("Cache-Control", "no-store");
    res.json({ conversation, messages });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  is_active: z.boolean().optional(),
});

conversationsRouter.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = idSchema.parse(req.params);
    const body = patchSchema.parse(req.body);

    const row = await queryOne(
      `UPDATE ai_conversations
          SET title = COALESCE($1, title),
              is_active = COALESCE($2, is_active),
              updated_at = NOW()
        WHERE id = $3 AND user_id = $4
      RETURNING id, title, is_active, updated_at`,
      [body.title ?? null, body.is_active ?? null, id, req.user!.sub],
    );
    if (!row) return res.status(404).json({ error: "Conversation not found" });

    res.set("Cache-Control", "no-store");
    res.json({ conversation: row });
  } catch (err) {
    next(err);
  }
});

/**
 * Soft delete.
 *
 * The row stays so the ledger's foreign keys and any moderation trail survive,
 * but it leaves every list. A user asking to delete an assistant conversation
 * usually means "I do not want this on my screen", and this is that.
 *
 * A hard delete belongs in account deletion, where the intent is unambiguous.
 */
conversationsRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = idSchema.parse(req.params);
    const row = await queryOne<{ id: string }>(
      `UPDATE ai_conversations SET is_active = false, updated_at = NOW()
        WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.user!.sub],
    );
    if (!row) return res.status(404).json({ error: "Conversation not found" });

    res.set("Cache-Control", "no-store");
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

const feedbackSchema = z.object({
  message_id: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  feedback_text: z.string().max(2000).optional(),
});

/**
 * Thumbs on one answer.
 *
 * Scoped through a join to the conversation's owner: a message id alone is not
 * proof the caller ever saw the message. Upserted rather than inserted so a
 * client retry, or a user changing their mind, updates one row instead of
 * quietly double-counting the aggregate the admin console reads.
 */
conversationsRouter.post("/feedback", requireAuth, async (req, res, next) => {
  try {
    const body = feedbackSchema.parse(req.body);

    const owned = await queryOne<{ id: string }>(
      `SELECT m.id
         FROM ai_messages m
         JOIN ai_conversations c ON c.id = m.conversation_id
        WHERE m.id = $1 AND c.user_id = $2`,
      [body.message_id, req.user!.sub],
    );
    if (!owned) return res.status(404).json({ error: "Message not found" });

    const row = await queryOne(
      `INSERT INTO ai_feedback (message_id, user_id, rating, feedback_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating,
                     feedback_text = EXCLUDED.feedback_text,
                     created_at = NOW()
       RETURNING id, rating, created_at`,
      [body.message_id, req.user!.sub, body.rating, body.feedback_text ?? null],
    );

    res.set("Cache-Control", "no-store");
    res.status(201).json({ feedback: row });
  } catch (err) {
    next(err);
  }
});
