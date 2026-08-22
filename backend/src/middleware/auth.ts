import type { Request, Response, NextFunction } from "express";
import { adminAuth } from "../lib/firebase-admin";
import { query, queryOne } from "../db";

/**
 * Firebase is the identity provider; Postgres holds the profile;
 * users.firebase_uid joins them. Every endpoint enforces its own authorization
 * from `req.user` -- client-side role checks are UX, never a control.
 */

export type Role = "super_admin" | "admin" | "student" | "mentor" | "employer";

export type AuthUser = {
  /** Postgres users.id (UUID) -- what every domain table FKs to. */
  sub: string;
  /** Firebase Auth UID -- the identity from the verified token. */
  firebaseUid: string;
  email: string;
  role: Role;
};

const VALID_ROLES = new Set<Role>(["super_admin", "admin", "student", "mentor", "employer"]);

export function isAdmin(role: Role): boolean {
  return role === "super_admin" || role === "admin";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * firebase_uid -> { id, role }, cached for 60s.
 *
 * The cache is keyed by Firebase UID rather than by token, so the same account
 * signed in on a phone and a laptop shares one entry and both devices see a
 * role change at the same moment. The TTL bounds how long a stale role can
 * survive an out-of-band database edit; `clearUserCache` handles the in-band
 * cases (role change, suspend, delete) immediately.
 */
const userCache = new Map<string, { id: string; role: Role; expires: number }>();
const CACHE_TTL_MS = 60_000;

export function clearUserCache(firebaseUid: string): void {
  userCache.delete(firebaseUid);
}

/** Test seam and admin-tooling escape hatch: drop every cached entry. */
export function clearAllUserCache(): void {
  userCache.clear();
}

async function resolvePostgresUser(
  firebaseUid: string,
  email: string,
  name: string | undefined,
  claimRole: Role,
): Promise<{ id: string; role: Role }> {
  const cached = userCache.get(firebaseUid);
  if (cached && cached.expires > Date.now()) return { id: cached.id, role: cached.role };

  let row = await queryOne<{ id: string; role: Role }>(
    `SELECT id, role FROM users WHERE firebase_uid = $1`,
    [firebaseUid],
  );

  if (!row) {
    // Self-heal: a verified Firebase identity with no profile row. This is
    // reachable when register-profile failed after account creation. It is safe
    // only because checkRevoked below has already established the Firebase
    // account still exists -- without that, a token from a deleted account
    // would recreate the row it was deleted with.
    const fullName = (name && name.trim()) || email.split("@")[0] || "User";
    await query(
      `INSERT INTO users (firebase_uid, email, full_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (firebase_uid) DO NOTHING`,
      [firebaseUid, email, fullName, claimRole],
    );
    row = await queryOne<{ id: string; role: Role }>(
      `SELECT id, role FROM users WHERE firebase_uid = $1`,
      [firebaseUid],
    );
  }

  if (!row) throw new Error("Failed to resolve Postgres user for Firebase uid");

  userCache.set(firebaseUid, { id: row.id, role: row.role, expires: Date.now() + CACHE_TTL_MS });
  return row;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

function roleFromClaims(decoded: Record<string, unknown>): Role {
  const raw = decoded.role;
  return typeof raw === "string" && VALID_ROLES.has(raw as Role) ? (raw as Role) : "student";
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing auth token", code: "auth/missing-token" });
  }
  try {
    // checkRevoked=true. Without it a token issued before an account was
    // suspended or deleted keeps verifying until it naturally expires -- JWTs
    // are stateless, so "we revoked their sessions" means nothing to a
    // signature check. An admin suspending an abusive account has to take
    // effect on the next request, not up to an hour later.
    const decoded = await adminAuth.verifyIdToken(token, true);
    const email = decoded.email ?? "";
    const pgUser = await resolvePostgresUser(
      decoded.uid,
      email,
      (decoded as { name?: string }).name,
      roleFromClaims(decoded as unknown as Record<string, unknown>),
    );

    req.user = { sub: pgUser.id, firebaseUid: decoded.uid, email, role: pgUser.role };
    next();
  } catch (err) {
    const code = (err as { code?: string }).code;
    // The app distinguishes these: a revoked token means sign out and show the
    // session-ended screen, an expired one means refresh and retry exactly
    // once. Collapsing both into "Invalid token" produces a client that either
    // retries forever or signs the user out on every backgrounded hour.
    if (code === "auth/id-token-revoked" || code === "auth/user-disabled") {
      return res.status(401).json({ error: "Session ended", code: "auth/revoked" });
    }
    return res.status(401).json({ error: "Invalid or expired token", code: "auth/invalid-token" });
  }
}

/**
 * Populates req.user when a valid token is present, and continues either way.
 *
 * For routes that are genuinely public but widen what they return for the owner
 * or an admin -- a housing listing is the example: anyone may read an active
 * one, only the landlord or an admin may read one that has been taken down.
 * Never rejects; it is the route's job to then apply the public rules.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return next();
  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    const pgUser = await resolvePostgresUser(
      decoded.uid,
      decoded.email ?? "",
      (decoded as { name?: string }).name,
      roleFromClaims(decoded as unknown as Record<string, unknown>),
    );
    req.user = {
      sub: pgUser.id,
      firebaseUid: decoded.uid,
      email: decoded.email ?? "",
      role: pgUser.role,
    };
  } catch {
    /* anonymous -- the route applies its public rules */
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (req.user.role === "super_admin") return next();
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to do this" });
    }
    next();
  };
}

export function requireAdmin() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to do this" });
    }
    next();
  };
}
