import { z } from "zod";

/**
 * One pagination contract for every list endpoint.
 *
 * The web platform grew a different shape per router -- some capped at a fixed
 * limit with no offset at all, which on a "Load more" button looks like "there
 * is nothing else" and on an infinite-scroll list looks like the list simply
 * stops. Both are silent: the response is a valid 200 with rows in it. The only
 * way that bug gets caught is by seeding past the cap and paging to the end,
 * which is why `hasMore` is computed from a real total rather than inferred
 * from `items.length === limit`.
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * Coerce, then bound. A querystring is always strings, and an unbounded `limit`
 * is a denial-of-service primitive on a table that will not always have five
 * rows in it.
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof paginationSchema>;

export type ListEnvelope<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

/**
 * Build the response body for a list endpoint.
 *
 * `legacyKey` additively duplicates `items` under the key the web frontend
 * already reads (`listings`, `opportunities`, ...). It costs one extra
 * reference in the JSON -- not a second copy of the rows -- and it is what
 * makes this envelope shippable without a coordinated frontend release. It is
 * a deprecation, not a permanent part of the contract.
 */
export function listEnvelope<T>(
  items: T[],
  total: number,
  { limit, offset }: Pagination,
  legacyKey?: string,
): ListEnvelope<T> & Record<string, unknown> {
  const body: ListEnvelope<T> & Record<string, unknown> = {
    items,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
  };
  if (legacyKey) body[legacyKey] = items;
  return body;
}

/**
 * Read the window count out of a `COUNT(*) OVER()` column.
 *
 * Counting in the same statement that fetches the page keeps the filter
 * predicate in exactly one place. Two statements means two WHERE clauses that
 * have to be kept identical by hand, and when they drift `hasMore` starts
 * lying -- which is the failure this envelope exists to prevent.
 *
 * An empty page legitimately produces no rows and therefore no window value;
 * that is a total of 0 for this filter, not an error.
 */
export function totalFromWindow(rows: Array<{ total_count?: string | number }>): number {
  if (rows.length === 0) return 0;
  const raw = rows[0].total_count;
  return typeof raw === "number" ? raw : Number(raw ?? 0);
}
