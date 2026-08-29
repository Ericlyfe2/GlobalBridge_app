import { z } from "zod";

/**
 * Timestamp cursors that survive a round trip.
 *
 * ── The bug this exists to prevent ────────────────────────────────────────
 * PostgreSQL stores `timestamptz` with **microsecond** precision. The `pg`
 * driver parses it into a JavaScript `Date`, which has **millisecond**
 * precision. So a row written at `...:48.123456Z` comes back to Node as
 * `...:48.123Z`, and a cursor built from it is 456 microseconds *earlier* than
 * the row it is supposed to point past.
 *
 * Every delta endpoint filters with `WHERE created_at > $cursor`. Feed it a
 * truncated cursor and the row matches again — and again, on every subsequent
 * call, because the cursor derived from it is truncated the same way each time.
 * The client re-downloads the same tail on every foreground, forever, and the
 * cursor never advances past it.
 *
 * It is invisible in a mocked test: the fixtures are JS Dates with no
 * sub-millisecond component, so truncation is a no-op and the round trip looks
 * clean. It only appears against a real database.
 *
 * ── The fix ───────────────────────────────────────────────────────────────
 * Cursors never become `Date` objects. They are produced by Postgres as a
 * fixed-format UTC string carrying all six fractional digits, passed back as
 * text, and cast to `timestamptz` in the comparison. The format sorts
 * lexicographically, which is what lets the newest of several be picked without
 * parsing any of them.
 */

/**
 * SQL fragment rendering a timestamptz as a full-precision, sortable UTC string.
 *
 * `2026-08-29T21:21:48.123456Z`. Postgres parses this format back without a
 * hint, and it is byte-comparable because the offset is pinned to UTC and every
 * field is zero-padded to a fixed width.
 */
export function cursorExpr(expr: string): string {
  return `to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Accepts the format above, and also a plain millisecond ISO string so a client
 * holding a cursor from an older build is not broken by this change.
 */
const CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export const cursorSchema = z
  .string()
  .regex(CURSOR_PATTERN, "cursor must be an ISO-8601 UTC timestamp")
  .refine((value) => !Number.isNaN(Date.parse(value)), "cursor is not a valid timestamp");

/** For range checks only — never for building a cursor to send back. */
export function cursorToDate(cursor: string): Date {
  return new Date(cursor);
}

export function dateToCursor(date: Date): string {
  // Millisecond precision, which is all a JS Date has. Only used for a cursor
  // this service synthesises itself (a horizon), never for one derived from a
  // stored row.
  return date.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

/**
 * The newest of several cursor strings, or `fallback` when there are none.
 *
 * Compared as strings rather than parsed: parsing is what discards the
 * precision this module exists to preserve.
 */
export function newestCursor(fallback: string, ...groups: { cursor?: string }[][]): string {
  let newest = fallback;
  for (const rows of groups) {
    for (const row of rows) {
      if (typeof row.cursor === "string" && row.cursor > newest) newest = row.cursor;
    }
  }
  return newest;
}
