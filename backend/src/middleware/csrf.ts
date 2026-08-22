import type { Request, Response, NextFunction } from "express";

/**
 * Origin-checking CSRF defense.
 *
 * ── Why a header-less request is allowed through ──────────────────────────
 * A native app sends neither Origin nor Referer. Neither does a
 * server-to-server call. Letting those through looks like a hole and is not,
 * for a specific reason: CSRF is an attack on *ambient* credentials -- the
 * browser attaching a cookie to a request the user did not intend to make.
 * This API authenticates with a Bearer token that has to be read out of secure
 * storage and attached deliberately by the caller. An attacker's page cannot
 * make the victim's browser attach it.
 *
 * So the invariant that makes this safe is narrow and worth stating: **this
 * carve-out holds only as long as no endpoint here accepts cookie
 * authentication.** The moment one does, a header-less request stops being
 * unforgeable and this check has to become a token check instead.
 *
 * A request that *does* carry an Origin is a browser request, and is held to
 * the allow-list -- a forged Origin from an attacker's page is refused.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function extractOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function allowedOrigins(): Set<string> {
  return new Set(
    (process.env.CORS_ORIGIN || "http://localhost:3000")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  if (!origin && !referer) return next();

  const allowed = allowedOrigins();
  const validOrigin = origin ? allowed.has(origin) : false;
  const validReferer = referer ? allowed.has(extractOrigin(referer) || "") : false;

  if (!validOrigin && !validReferer) {
    return res.status(403).json({ error: "Request blocked", code: "security/csrf" });
  }

  next();
}
