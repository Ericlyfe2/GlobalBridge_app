import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { optionalAuth } from "../middleware/auth";
import { paginationSchema, listEnvelope, totalFromWindow } from "../lib/pagination";
import { escapeLike } from "../lib/sanitize";

export const opportunitiesRouter = Router();

const listQuerySchema = paginationSchema.extend({
  type: z.enum(["scholarship", "internship", "grant", "exchange", "fellowship", "job"]).optional(),
  country: z.string().max(100).optional(),
  field_of_study: z.string().max(255).optional(),
  sponsors_visa: z.coerce.boolean().optional(),
  verified_only: z.coerce.boolean().optional(),
  q: z.string().max(200).optional(),
  /** Hide anything whose deadline has already passed. Defaults on. */
  open_only: z.coerce.boolean().default(true),
});

opportunitiesRouter.get("/", optionalAuth, async (req, res, next) => {
  try {
    const p = listQuerySchema.parse(req.query);
    const filters: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (p.type) {
      filters.push(`o.type = $${i++}`);
      values.push(p.type);
    }
    if (p.country) {
      filters.push(`o.country ILIKE $${i++}`);
      values.push(p.country);
    }
    if (p.field_of_study) {
      filters.push(`o.field_of_study ILIKE $${i} ESCAPE '\\'`);
      values.push(`%${escapeLike(p.field_of_study)}%`);
      i++;
    }
    if (p.sponsors_visa !== undefined) {
      filters.push(`o.sponsors_visa = $${i++}`);
      values.push(p.sponsors_visa);
    }
    if (p.verified_only) {
      filters.push(`o.is_verified = TRUE`);
    }
    if (p.q) {
      filters.push(`(o.title ILIKE $${i} ESCAPE '\\' OR o.description ILIKE $${i} ESCAPE '\\')`);
      values.push(`%${escapeLike(p.q)}%`);
      i++;
    }
    // An opportunity with no deadline is open-ended, not expired.
    if (p.open_only) {
      filters.push(`(o.deadline IS NULL OR o.deadline >= CURRENT_DATE)`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const rows = await query<Record<string, unknown> & { total_count: string }>(
      `SELECT o.id, o.type, o.title, o.country, o.institution, o.field_of_study,
              o.funding_amount, o.currency, o.deadline, o.sponsors_visa,
              o.is_verified, o.application_url, o.created_at,
              COUNT(*) OVER() AS total_count
         FROM opportunities o
         ${where}
        ORDER BY o.deadline ASC NULLS LAST, o.created_at DESC, o.id DESC
        LIMIT $${i++} OFFSET $${i++}`,
      [...values, p.limit, p.offset],
    );

    const total = totalFromWindow(rows);
    const items = rows.map(({ total_count, ...rest }) => rest);

    res.set("Cache-Control", "public, max-age=60");
    res.json(listEnvelope(items, total, { limit: p.limit, offset: p.offset }, "opportunities"));
  } catch (err) {
    next(err);
  }
});

opportunitiesRouter.get("/:id", optionalAuth, async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await query(`SELECT * FROM opportunities WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: "Opportunity not found" });
    res.set("Cache-Control", "public, max-age=60");
    res.json({ opportunity: rows[0] });
  } catch (err) {
    next(err);
  }
});
