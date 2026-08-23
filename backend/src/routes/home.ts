import { Router } from "express";
import { query, queryOne } from "../db";
import { requireAuth } from "../middleware/auth";
import { sendWithEtag } from "../lib/etag";
import { routes } from "../lib/deep-links";
import { SAFE_TZ } from "../lib/reminders/time";

export const homeRouter = Router();

/**
 * GET /home — everything the first screen needs, in one request.
 *
 * ── Why this endpoint exists ──────────────────────────────────────────────
 * The home screen needs eight unrelated things: who you are, how far through
 * your checklist, what is due next, how many unread messages and notifications,
 * what you saved, and a few opportunities. As separate endpoints that is eight
 * round trips before the first screen renders — paid on the worst network the
 * user will have all day, in front of a splash screen. On a dorm connection
 * that is the difference between an app that feels instant and one that feels
 * broken.
 *
 * ── The rules this endpoint holds itself to ───────────────────────────────
 * **A fixed number of queries.** Everything runs in one `Promise.all`. The
 * count does not vary with how much data the user has, which is the property
 * that makes an N+1 impossible here rather than merely absent today. The dev
 * query logger prints the count on every request so a regression is visible
 * while it is being written.
 *
 * **No unbounded arrays.** Every list has an explicit LIMIT, and the limits are
 * small — this is a summary screen, and a user with four hundred saved items
 * does not need four hundred rows to see that they have some. Counts come back
 * as counts; the lists are previews with their own endpoints behind them.
 *
 * **No volatile fields.** There is no `generated_at` in the payload, on purpose:
 * a timestamp would change the ETag on every request and turn every
 * revalidation back into a full response. The client renders the greeting and
 * any relative times from its own clock.
 */

/** Preview sizes. Deliberately small — this is a summary, not a list screen. */
const OPPORTUNITY_PREVIEW = 3;
const SAVED_PREVIEW = 4;
const ALERT_PREVIEW = 5;

type ChecklistRow = {
  id: string;
  destination_country: string;
  visa_type: string;
  total_items: number;
  completed_count: number;
};

homeRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.sub;

    const [
      profile,
      checklist,
      nextDeadline,
      nextBooking,
      unread,
      savedPreview,
      opportunities,
      alerts,
    ] = await Promise.all([
      queryOne<{
        full_name: string;
        avatar_url: string | null;
        role: string;
        country_of_origin: string | null;
        country_of_residence: string | null;
        preferred_language: string | null;
        timezone: string | null;
        verification_status: string | null;
        profile_completed_at: Date | null;
      }>(
        `SELECT full_name, avatar_url, role, country_of_origin, country_of_residence,
                preferred_language, timezone, verification_status, profile_completed_at
           FROM users WHERE id = $1`,
        [userId],
      ),

      // Progress is computed in SQL rather than by pulling the items JSONB back
      // and counting in Node: a roadmap can hold forty phases with long text
      // fields, and this screen needs two integers from it.
      queryOne<ChecklistRow>(
        `SELECT id, destination_country, visa_type,
                jsonb_array_length(items) AS total_items,
                COALESCE(array_length(completed_items, 1), 0) AS completed_count
           FROM visa_checklists
          WHERE user_id = $1 AND jsonb_typeof(items) = 'array'
          ORDER BY COALESCE(updated_at, created_at) DESC
          LIMIT 1`,
        [userId],
      ),

      // Nearest deadline among the opportunities this user actually saved.
      // Unsaved opportunities are not "your next deadline" — they are browsing.
      queryOne<{ id: string; title: string; deadline: string; days_left: number }>(
        `SELECT o.id, o.title, o.deadline::text AS deadline,
                (o.deadline - CURRENT_DATE) AS days_left
           FROM saved_items s
           JOIN opportunities o ON o.id = s.item_id
          WHERE s.user_id = $1
            AND s.item_type = 'opportunity'
            AND o.deadline IS NOT NULL
            AND o.deadline >= CURRENT_DATE
          ORDER BY o.deadline ASC
          LIMIT 1`,
        [userId],
      ),

      // Resolved to an absolute instant the same way the reminder scheduler
      // does it, so the home screen and the notification cannot disagree about
      // when a session is.
      queryOne<{
        id: string;
        starts_at: Date;
        other_name: string;
        is_mentor: boolean;
      }>(
        `SELECT b.id,
                (b.slot_date + b.slot_time)
                  AT TIME ZONE ${SAFE_TZ("COALESCE(b.student_timezone, su.timezone)")} AS starts_at,
                CASE WHEN b.student_id = $1 THEN mu.full_name ELSE su.full_name END AS other_name,
                (b.mentor_id = $1) AS is_mentor
           FROM mentor_bookings b
           JOIN users su ON su.id = b.student_id
           JOIN users mu ON mu.id = b.mentor_id
          WHERE (b.student_id = $1 OR b.mentor_id = $1)
            AND b.status IN ('pending', 'confirmed')
            AND (b.slot_date + b.slot_time)
                  AT TIME ZONE ${SAFE_TZ("COALESCE(b.student_timezone, su.timezone)")} >= NOW()
          ORDER BY starts_at ASC
          LIMIT 1`,
        [userId],
      ),

      // Both badge counts in one statement rather than two round trips for two
      // integers.
      queryOne<{ messages: string; notifications: string }>(
        `SELECT
           (SELECT COUNT(*) FROM messages m
              JOIN conversations c ON c.id = m.conversation_id
             WHERE (c.participant_a = $1 OR c.participant_b = $1)
               AND m.sender_id <> $1
               AND m.is_read = FALSE) AS messages,
           (SELECT COUNT(*) FROM notifications
             WHERE user_id = $1 AND read = FALSE) AS notifications`,
        [userId],
      ),

      query(
        `SELECT id, item_type, item_id, created_at
           FROM saved_items
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT ${SAVED_PREVIEW}`,
        [userId],
      ),

      // A small slice of open, verified-first opportunities. Not personalised
      // yet — that needs a matching model this service does not have, and a
      // fake "recommended for you" is worse than an honest "closing soon".
      query(
        `SELECT id, type, title, country, deadline, funding_amount, currency, is_verified
           FROM opportunities
          WHERE deadline IS NULL OR deadline >= CURRENT_DATE
          ORDER BY is_verified DESC, deadline ASC NULLS LAST, created_at DESC
          LIMIT ${OPPORTUNITY_PREVIEW}`,
      ),

      // Security and deadline notifications outrank everything else on this
      // screen. They are the two categories the product exists to get in front
      // of someone in time.
      query(
        `SELECT id, kind, title, body, deep_link, created_at
           FROM notifications
          WHERE user_id = $1 AND read = FALSE AND kind IN ('security', 'deadline')
          ORDER BY created_at DESC
          LIMIT ${ALERT_PREVIEW}`,
        [userId],
      ),
    ]);

    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const checklistProgress = checklist
      ? {
          id: checklist.id,
          destination_country: checklist.destination_country,
          visa_type: checklist.visa_type,
          total: Number(checklist.total_items),
          completed: Number(checklist.completed_count),
          percent:
            Number(checklist.total_items) > 0
              ? Math.round((Number(checklist.completed_count) / Number(checklist.total_items)) * 100)
              : 0,
          href: routes.roadmap(),
        }
      : null;

    const payload = {
      user: {
        full_name: profile.full_name,
        avatar_url: profile.avatar_url,
        role: profile.role,
        country_of_origin: profile.country_of_origin,
        country_of_residence: profile.country_of_residence,
        preferred_language: profile.preferred_language,
        timezone: profile.timezone,
        verification_status: profile.verification_status,
        profile_complete: Boolean(profile.profile_completed_at),
      },
      checklist: checklistProgress,
      next_deadline: nextDeadline
        ? {
            opportunity_id: nextDeadline.id,
            title: nextDeadline.title,
            deadline: nextDeadline.deadline,
            days_left: Number(nextDeadline.days_left),
            href: routes.opportunity(nextDeadline.id),
          }
        : null,
      next_session: nextBooking
        ? {
            booking_id: nextBooking.id,
            // ISO instant. The client renders it in the viewer's own zone --
            // sending a preformatted local time would be wrong the moment
            // someone travels, which this audience does by definition.
            starts_at: new Date(nextBooking.starts_at).toISOString(),
            with_name: nextBooking.other_name,
            viewer_is_mentor: nextBooking.is_mentor,
            href: routes.booking(nextBooking.id),
          }
        : null,
      unread: {
        messages: Number(unread?.messages ?? 0),
        notifications: Number(unread?.notifications ?? 0),
      },
      alerts: alerts.map((a) => a),
      saved: savedPreview,
      opportunities,
    };

    // 304s when nothing has changed since the app last asked, which between two
    // launches a minute apart is the common case.
    sendWithEtag(req, res, payload);
  } catch (err) {
    next(err);
  }
});
