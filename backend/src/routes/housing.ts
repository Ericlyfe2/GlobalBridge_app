import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { optionalAuth } from "../middleware/auth";
import { paginationSchema, listEnvelope, totalFromWindow } from "../lib/pagination";
import { escapeLike } from "../lib/sanitize";

export const housingRouter = Router();

/**
 * GET /housing
 *
 * This endpoint previously took `limit` and no `offset`, which on a "Load more"
 * button reads as "there is nothing else" and on infinite scroll reads as a
 * list that simply stops. It had never surfaced because there were only a
 * handful of listings -- the bug was latent, not absent, and a mobile client
 * scrolling a real dataset is what detonates it.
 */
const listQuerySchema = paginationSchema.extend({
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  q: z.string().max(200).optional(),
  max_rent: z.coerce.number().positive().optional(),
  currency: z.string().length(3).optional(),
  furnished: z.coerce.boolean().optional(),
});

housingRouter.get("/", optionalAuth, async (req, res, next) => {
  try {
    const { limit, offset, city, country, q, max_rent, currency, furnished } =
      listQuerySchema.parse(req.query);

    const filters: string[] = [`hl.status = 'active'`];
    const values: unknown[] = [];
    let i = 1;

    if (city) {
      filters.push(`hl.city ILIKE $${i++}`);
      values.push(city);
    }
    if (country) {
      filters.push(`hl.country ILIKE $${i++}`);
      values.push(country);
    }
    if (furnished !== undefined) {
      filters.push(`hl.furnished = $${i++}`);
      values.push(furnished);
    }
    if (q) {
      // escapeLike + ESCAPE '\': without both, a literal % in the search box
      // matches every row and the filter silently does nothing.
      filters.push(`(hl.title ILIKE $${i} ESCAPE '\\' OR hl.city ILIKE $${i} ESCAPE '\\')`);
      values.push(`%${escapeLike(q)}%`);
      i++;
    }

    // Listings are priced in different currencies with no conversion anywhere
    // in this system, so "rent_amount <= max_rent" only means something once
    // every row being compared shares one currency. Without a currency filter
    // this would put an expensive GBP listing next to a cheaper CAD one purely
    // because the raw numbers are close. Real budgets: refusing to apply the
    // filter is safer than silently misleading.
    if (max_rent !== undefined && currency) {
      filters.push(`hl.rent_amount <= $${i++}`);
      values.push(max_rent);
    }

    const rows = await query<Record<string, unknown> & { total_count: string }>(
      `SELECT hl.id, hl.title, hl.city, hl.country, hl.rent_amount, hl.currency,
              hl.rent_period, hl.bedrooms, hl.bathrooms, hl.furnished, hl.photos,
              hl.rating, hl.created_at,
              u.full_name AS landlord_name,
              u.verification_status AS landlord_status,
              COUNT(*) OVER() AS total_count
         FROM housing_listings hl
         JOIN users u ON u.id = hl.landlord_id
        WHERE ${filters.join(" AND ")}
        ORDER BY hl.rating DESC, hl.created_at DESC, hl.id DESC
        LIMIT $${i++} OFFSET $${i++}`,
      [...values, limit, offset],
    );

    const total = totalFromWindow(rows);
    const items = rows.map(({ total_count, ...rest }) => rest);

    // Public, non-personalised, and identical for every caller with the same
    // querystring -- the one shape that is safe in a shared cache.
    res.set("Cache-Control", "public, max-age=60");
    res.json(listEnvelope(items, total, { limit, offset }, "listings"));
  } catch (err) {
    next(err);
  }
});

housingRouter.get("/:id", optionalAuth, async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const rows = await query(
      `SELECT hl.*, u.full_name AS landlord_name, u.verification_status AS landlord_status
         FROM housing_listings hl
         JOIN users u ON u.id = hl.landlord_id
        WHERE hl.id = $1`,
      [id],
    );

    const listing = rows[0] as
      | (Record<string, unknown> & { status: string; landlord_id: string })
      | undefined;
    if (!listing) return res.status(404).json({ error: "Listing not found" });

    // A listing that is not active is visible to its landlord and to admins.
    // Anyone else gets the same 404 as a listing that does not exist -- a 403
    // would confirm that a moderated listing exists at that id.
    const viewer = req.user;
    const isOwner = viewer?.sub === listing.landlord_id;
    const isStaff = viewer?.role === "admin" || viewer?.role === "super_admin";
    if (listing.status !== "active" && !isOwner && !isStaff) {
      return res.status(404).json({ error: "Listing not found" });
    }

    res.set("Cache-Control", listing.status === "active" ? "public, max-age=60" : "no-store");
    res.json({ listing });
  } catch (err) {
    next(err);
  }
});
