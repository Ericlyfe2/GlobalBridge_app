import crypto from "node:crypto";
import type { Request, Response } from "express";

/**
 * Conditional responses for authenticated, per-user payloads.
 *
 * ── The caching nuance ────────────────────────────────────────────────────
 * Everything else in this service sends `Cache-Control: no-store` on
 * authenticated responses, and the reason is that a shared, origin-scoped cache
 * holding one user's data can serve it to the next user of the same browser or
 * proxy.
 *
 * `no-store` here would be the wrong instrument, though, because it also
 * forbids the *client's own private* cache from keeping a copy — and without a
 * stored copy there is nothing for `If-None-Match` to revalidate against, so
 * the ETag can never produce a 304 and the whole mechanism is decorative.
 *
 * `private, max-age=0, must-revalidate` says exactly what is meant: this
 * belongs to one user, never put it in a shared cache, and check with the
 * server before reusing it. The app then pays a round trip but not a payload,
 * which on a cold start over a slow connection is most of the cost.
 *
 * ── Why the hash covers the body and nothing else ─────────────────────────
 * An ETag derived from a timestamp, a row version, or "now" changes when
 * nothing the user can see has changed, which turns every revalidation back
 * into a full response. Hashing the serialised payload means a 304 happens
 * exactly when the answer really is identical — which for a home screen between
 * two app launches a minute apart is the common case.
 *
 * The payload therefore must not contain a generated-at timestamp or anything
 * else that varies per request. That is a constraint on the caller, and it is
 * why the aggregate endpoints return data only and let the client render the
 * time-dependent parts.
 */

/** A weak ETag over the JSON serialisation of `payload`. */
export function etagFor(payload: unknown): string {
  const hash = crypto
    .createHash("sha1")
    .update(JSON.stringify(payload))
    .digest("base64url")
    .slice(0, 27);
  // Weak, because this is a semantic equality claim about the JSON, not a
  // byte-for-byte guarantee about the transfer encoding.
  return `W/"${hash}"`;
}

/**
 * Send `payload`, or a 304 when the client already has this exact version.
 *
 * Returns true if a 304 was sent, so callers can avoid further work.
 */
export function sendWithEtag(req: Request, res: Response, payload: unknown): boolean {
  const etag = etagFor(payload);

  res.set("ETag", etag);
  res.set("Cache-Control", "private, max-age=0, must-revalidate");
  // Two users must never share a cached entry even in an intermediary that
  // ignores `private`.
  res.set("Vary", "Authorization");

  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch && matchesEtag(ifNoneMatch, etag)) {
    res.status(304).end();
    return true;
  }

  res.json(payload);
  return false;
}

/**
 * Does the client's `If-None-Match` cover our tag?
 *
 * The header is a comma-separated list and may carry both weak and strong forms
 * of the same tag, so a plain string comparison misses matches that should be
 * 304s. Comparison is weak — `W/"x"` and `"x"` are the same resource version
 * for this purpose.
 */
function matchesEtag(header: string | string[], etag: string): boolean {
  const value = Array.isArray(header) ? header.join(",") : header;
  if (value.trim() === "*") return true;

  const normalise = (tag: string) => tag.trim().replace(/^W\//, "");
  const ours = normalise(etag);

  return value.split(",").some((candidate) => normalise(candidate) === ours);
}
