import { Router } from "express";
import { z } from "zod";
import { queryOne } from "../db";
import { requireAuth, clearUserCache } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { normalizeLocale } from "../lib/i18n";

export const authRouter = Router();

/**
 * Firebase owns credentials. This service owns the profile.
 *
 * The client creates the Firebase account, gets an ID token, and calls
 * register-profile with it. That ordering has one trap, and it is the reason
 * the app must roll back on failure: if profile creation fails after the
 * Firebase account exists, the user is left with credentials that authenticate
 * but no profile -- they can "sign in" to nothing, and they cannot sign up
 * again because the email is taken. The client deletes the Firebase user on a
 * failed profile write. This endpoint's job is to make that outcome rare and
 * unambiguous.
 */

const registerSchema = z.object({
  full_name: z.string().min(1).max(255),
  // Role is accepted only on the very first registration. See below.
  role: z.enum(["student", "mentor", "employer"]).default("student"),
  country_of_origin: z.string().max(100).optional(),
  country_of_residence: z.string().max(100).optional(),
  preferred_language: z.string().max(10).optional(),
  timezone: z.string().max(64).optional(),
});

authRouter.post("/register-profile", requireAuth, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const { sub, firebaseUid, email } = req.user!;

    const existing = await queryOne<{ profile_completed_at: Date | null }>(
      `SELECT profile_completed_at FROM users WHERE id = $1`,
      [sub],
    );

    // requireAuth self-heals a minimal row on first sight, so "a row exists"
    // cannot distinguish a first registration from a replay. Without this
    // check, any account could re-POST here to reassign its own role -- which
    // is a privilege escalation dressed as a signup call.
    if (existing?.profile_completed_at) {
      throw new HttpError(409, "This profile has already been set up", "auth/already-registered");
    }

    const user = await queryOne(
      `UPDATE users
          SET full_name = $2,
              role = $3,
              country_of_origin = COALESCE($4, country_of_origin),
              country_of_residence = COALESCE($5, country_of_residence),
              preferred_language = COALESCE($6, preferred_language),
              timezone = COALESCE($7, timezone),
              profile_completed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
      RETURNING id, email, full_name, role, verification_status, avatar_url,
                country_of_residence, preferred_language, timezone, created_at`,
      [
        sub,
        body.full_name,
        body.role,
        body.country_of_origin ?? null,
        body.country_of_residence ?? null,
        body.preferred_language ? normalizeLocale(body.preferred_language) : null,
        body.timezone ?? null,
      ],
    );

    // The role may have just changed from the cached "student" default.
    clearUserCache(firebaseUid);

    res.status(201).json({ user, email });
  } catch (err) {
    next(err);
  }
});

/**
 * Who am I.
 *
 * The app calls this immediately after registration and on every cold start.
 * It is the authoritative answer for role -- the client's copy is UX only, and
 * every endpoint re-derives authorization from the token regardless of what the
 * app believes.
 */
authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await queryOne(
      `SELECT id, email, full_name, role, verification_status, avatar_url,
              country_of_origin, share_country_of_origin, country_of_residence,
              bio, trust_score, preferred_language, timezone,
              profile_completed_at, created_at
         FROM users
        WHERE id = $1`,
      [req.user!.sub],
    );

    if (!user) throw new HttpError(404, "Profile not found", "auth/no-profile");

    // Never cached: this is authenticated, per-user, and changes on role edits.
    res.set("Cache-Control", "no-store");
    res.json({
      user,
      // The app renders a "finish setting up your profile" state from this
      // rather than guessing from missing fields.
      profileComplete: Boolean((user as { profile_completed_at: Date | null }).profile_completed_at),
    });
  } catch (err) {
    next(err);
  }
});

const preferencesSchema = z.object({
  preferred_language: z.string().max(10).optional(),
  timezone: z.string().max(64).optional(),
  share_country_of_origin: z.boolean().optional(),
});

/**
 * Language and timezone.
 *
 * Both are server-side concerns, not just display settings: notification text
 * is localised from preferred_language before it is sent, and reminders resolve
 * against timezone. An app that changes its language locally without telling
 * the server produces a UI in one language and a lock screen in another.
 */
authRouter.patch("/preferences", requireAuth, async (req, res, next) => {
  try {
    const body = preferencesSchema.parse(req.body);
    const user = await queryOne(
      `UPDATE users
          SET preferred_language = COALESCE($2, preferred_language),
              timezone = COALESCE($3, timezone),
              share_country_of_origin = COALESCE($4, share_country_of_origin),
              updated_at = NOW()
        WHERE id = $1
      RETURNING id, preferred_language, timezone, share_country_of_origin`,
      [
        req.user!.sub,
        body.preferred_language ? normalizeLocale(body.preferred_language) : null,
        body.timezone ?? null,
        body.share_country_of_origin ?? null,
      ],
    );
    res.set("Cache-Control", "no-store");
    res.json({ user });
  } catch (err) {
    next(err);
  }
});
