/**
 * Escape the LIKE/ILIKE metacharacters in user-supplied search text.
 *
 * Without this, a search box is a filter-bypass: a literal `%` matches every
 * row, so "show me listings matching %" returns the entire table, and `_`
 * silently matches any single character. Neither is a SQL injection -- the
 * value is still a bound parameter -- which is exactly why it survives review.
 *
 * Callers must pair this with `ESCAPE '\'` on the SQL side, since the default
 * escape character is only applied when the pattern declares it.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Field allow-list for handlers that build a dynamic SET clause from req.body.
 * Returns only the named keys, so an unexpected property in a request body can
 * never become a column in an UPDATE.
 *
 * Values are not transformed. User text is stored verbatim -- escaping belongs
 * at the point of rendering, and storing pre-escaped text corrupts it for every
 * consumer that is not HTML.
 */
export function pickFields<T extends object>(body: T, allowed: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key];
  }
  return out;
}
