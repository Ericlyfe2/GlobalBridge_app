import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db";
import { requireAuth } from "../middleware/auth";

export const usersRouter = Router();

/**
 * Device token registry for native push.
 *
 * ── Why unregister-on-sign-out is not optional ────────────────────────────
 * An FCM token belongs to an app install, not to a person. If it stays mapped
 * to the previous user after sign-out, the next person to sign in on that phone
 * receives the previous user's notifications on their lock screen -- message
 * previews, visa deadlines, security alerts. This product's users share phones:
 * family members, roommates, internet cafés, a friend's handset while theirs is
 * being repaired. This is the native twin of never caching authenticated
 * responses in a shared store, and it has the same fix: the mapping must be
 * torn down at sign-out, by the client, before the Firebase session ends.
 */

const registerSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(["ios", "android"]),
  app_version: z.string().max(32).optional(),
  locale: z.string().max(10).optional(),
});

usersRouter.post("/device-tokens", requireAuth, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);

    // A token that was previously registered to a different account is
    // reassigned, not duplicated. That is the shared-phone case: the same
    // install, a new user. Leaving the old mapping in place would deliver the
    // previous user's notifications to whoever is holding the phone now.
    await query(`DELETE FROM device_tokens WHERE token = $1 AND user_id <> $2`, [
      body.token,
      req.user!.sub,
    ]);

    const row = await queryOne<{ id: string }>(
      `INSERT INTO device_tokens (user_id, token, platform, app_version, locale)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, token)
       DO UPDATE SET platform = EXCLUDED.platform,
                     app_version = EXCLUDED.app_version,
                     locale = EXCLUDED.locale,
                     last_seen_at = NOW()
       RETURNING id`,
      [
        req.user!.sub,
        body.token,
        body.platform,
        body.app_version ?? req.client?.version ?? null,
        body.locale ?? "en",
      ],
    );

    res.set("Cache-Control", "no-store");
    res.status(201).json({ id: row?.id, registered: true });
  } catch (err) {
    next(err);
  }
});

const unregisterSchema = z.object({ token: z.string().min(20).max(4096) });

/**
 * Called on sign-out, before the Firebase session is torn down -- this endpoint
 * needs a valid token to know whose mapping to remove.
 *
 * Scoped to the caller: a token can only be unregistered from the account that
 * is signed in. Otherwise anyone holding an FCM token string could silence
 * another user's notifications, which for a security alert is an attack.
 */
usersRouter.delete("/device-tokens", requireAuth, async (req, res, next) => {
  try {
    const body = unregisterSchema.parse(req.body);
    const removed = await query<{ id: string }>(
      `DELETE FROM device_tokens WHERE user_id = $1 AND token = $2 RETURNING id`,
      [req.user!.sub, body.token],
    );
    res.set("Cache-Control", "no-store");
    // Idempotent: signing out twice, or from a device whose token was already
    // pruned as dead, is a success, not a 404.
    res.json({ removed: removed.length });
  } catch (err) {
    next(err);
  }
});

/** What this account currently has registered. Powers the Settings screen. */
usersRouter.get("/device-tokens", requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, platform, app_version, locale, created_at, last_seen_at
         FROM device_tokens
        WHERE user_id = $1
        ORDER BY last_seen_at DESC`,
      [req.user!.sub],
    );
    // The token itself is never returned: it is a delivery credential, and the
    // Settings screen only needs to show "iPhone, last seen Tuesday".
    res.set("Cache-Control", "no-store");
    res.json({ devices: rows });
  } catch (err) {
    next(err);
  }
});
