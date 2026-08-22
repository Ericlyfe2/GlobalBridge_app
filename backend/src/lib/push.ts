import webpush from "web-push";
import { query, queryOne } from "../db";
import { notifyUsers } from "../ws";
import { adminMessaging } from "./firebase-admin";
import { env } from "../env";
import { normalizeLocale, t, type Locale } from "./i18n";
import { isSafeDeepLink } from "./deep-links";

/**
 * Notification delivery.
 *
 * The order is fixed and it is the whole design: **row first**, then fan-out.
 *
 *   1. INSERT into notifications  -- source of truth
 *   2. WebSocket                  -- the app is open right now
 *   3. Web push                   -- a browser is subscribed
 *   4. FCM                        -- the app is installed but closed
 *
 * Steps 2-4 are best-effort and every one of them can fail silently in normal
 * operation: notifications denied at the OS level, an expired subscription, a
 * token from an app that has been uninstalled, no network. If any of them were
 * the record, those users would simply never learn a deadline moved. Because
 * the row is written first, every one of them still sees it in the app.
 *
 * Nothing in this module throws. A notification failing must never roll back
 * the action that produced it -- booking a mentor has to succeed even when push
 * is misconfigured.
 */

const VAPID_PUBLIC = env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = env.VAPID_PRIVATE_KEY;

export const webPushEnabled = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
export const fcmEnabled = env.FCM_ENABLED;

if (webPushEnabled) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, VAPID_PUBLIC!, VAPID_PRIVATE!);
} else if (env.NODE_ENV !== "test") {
  console.warn("⚠ VAPID keys not set — web push disabled (in-app + WebSocket still work)");
}

if (!fcmEnabled && env.NODE_ENV !== "test") {
  console.warn("⚠ FCM_ENABLED not set — native push disabled (in-app + WebSocket still work)");
}

export type NotificationKind =
  | "message"
  | "deadline"
  | "opportunity"
  | "housing"
  | "job"
  | "mentor"
  | "security"
  | "document"
  | "info";

/**
 * Kinds that must never be collapsed or dropped.
 *
 * Collapsing is a courtesy for chatty categories -- five new opportunities
 * should be one line, not five. Applying it to a safety alert or a deadline
 * would mean the second one silently replaces the first, and these are exactly
 * the two categories where the second one is often the one that matters. This
 * audience is being actively targeted by scams and is working against
 * immigration deadlines; swallowing one of these has real consequences.
 */
const NEVER_COLLAPSE = new Set<NotificationKind>(["security", "deadline"]);

export type NotificationInput = {
  userId: string;
  kind: NotificationKind;
  /** i18n key; resolved server-side against the recipient's language. */
  titleKey: string;
  bodyKey?: string;
  vars?: Record<string, string>;
  /** Canonical app path from lib/deep-links.ts. */
  deepLink?: string;
  /** Small structured payload for routing. Never document contents or PII. */
  data?: Record<string, string>;
  /**
   * Repeats sharing a key fold into one delivery, unless the kind is in
   * NEVER_COLLAPSE. Absent, every notification is delivered on its own.
   */
  collapseKey?: string;
};

type DeviceTokenRow = { id: string; token: string; platform: string; locale: string };
type WebSubRow = { id: string; endpoint: string; p256dh: string; auth: string };

/**
 * Which language this user gets.
 *
 * The profile column is the answer, with the device locale as a fallback for
 * the case where the profile was never filled in. It is resolved once per
 * dispatch rather than per device: a user with a phone in Arabic and a laptop
 * in English has one preferred language, and sending each device a different
 * one produces a notification list that reads as half-broken.
 */
async function resolveLocale(userId: string, deviceLocale?: string): Promise<Locale> {
  const row = await queryOne<{ preferred_language: string | null }>(
    `SELECT preferred_language FROM users WHERE id = $1`,
    [userId],
  );
  return normalizeLocale(row?.preferred_language ?? deviceLocale ?? "en");
}

/**
 * True when an equivalent notification was already delivered recently.
 *
 * The window is deliberately short. This suppresses the duplicate-burst case --
 * the same event dispatched twice by a retry, or five of a kind arriving
 * together -- not a legitimate repeat an hour later.
 */
async function isCollapsed(userId: string, collapseKey: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM notifications
      WHERE user_id = $1 AND collapse_key = $2 AND created_at > NOW() - INTERVAL '10 minutes'
      LIMIT 1`,
    [userId, collapseKey],
  );
  return row !== null;
}

async function sendWebPush(userId: string, body: string): Promise<void> {
  if (!webPushEnabled) return;

  const subs = await query<WebSubRow>(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId],
  );
  if (subs.length === 0) return;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        await query(`UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = $1`, [s.id]);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 is the push service saying this subscription is permanently
        // gone. Retrying it forever is wasted work and a slow row leak.
        if (status === 404 || status === 410) {
          await query(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id]);
        } else {
          console.error("web push failed:", (err as Error).message);
        }
      }
    }),
  );
}

/** FCM error codes that mean the token is permanently dead, not temporarily failing. */
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

async function sendFcm(
  userId: string,
  payload: { title: string; body: string; kind: NotificationKind; deepLink: string; data: Record<string, string>; collapseKey?: string },
): Promise<void> {
  if (!fcmEnabled) return;

  const devices = await query<DeviceTokenRow>(
    `SELECT id, token, platform, locale FROM device_tokens WHERE user_id = $1`,
    [userId],
  );
  if (devices.length === 0) return;

  const highPriority = NEVER_COLLAPSE.has(payload.kind);

  const results = await Promise.all(
    devices.map(async (device) => {
      try {
        await adminMessaging.send({
          token: device.token,
          notification: { title: payload.title, body: payload.body },
          // Data keys must all be strings -- FCM rejects anything else at the
          // API boundary rather than at send time.
          data: {
            kind: payload.kind,
            deepLink: payload.deepLink,
            ...payload.data,
          },
          android: {
            priority: highPriority ? "high" : "normal",
            // Android's own collapse: a normal-priority repeat replaces the
            // undelivered one. Security and deadline pass no key, so each is
            // delivered separately even if the device was offline for both.
            collapseKey: highPriority ? undefined : payload.collapseKey,
            notification: { channelId: highPriority ? "critical" : "default" },
          },
          apns: {
            headers: {
              "apns-priority": highPriority ? "10" : "5",
              ...(highPriority || !payload.collapseKey
                ? {}
                : { "apns-collapse-id": payload.collapseKey.slice(0, 64) }),
            },
            payload: { aps: { sound: highPriority ? "default" : undefined } },
          },
        });
        await query(`UPDATE device_tokens SET last_seen_at = NOW() WHERE id = $1`, [device.id]);
        return null;
      } catch (err) {
        const code = (err as { code?: string; errorInfo?: { code?: string } }).code
          ?? (err as { errorInfo?: { code?: string } }).errorInfo?.code;
        if (code && DEAD_TOKEN_CODES.has(code)) return device.id;
        console.error("fcm send failed:", (err as Error).message);
        return null;
      }
    }),
  );

  const dead = results.filter((id): id is string => id !== null);
  if (dead.length) {
    await query(`DELETE FROM device_tokens WHERE id = ANY($1::uuid[])`, [dead]);
  }
}

/**
 * The one entry point call sites use.
 */
export async function dispatchNotification(input: NotificationInput): Promise<void> {
  try {
    if (input.collapseKey && !NEVER_COLLAPSE.has(input.kind)) {
      if (await isCollapsed(input.userId, input.collapseKey)) return;
    }

    const locale = await resolveLocale(input.userId);
    const title = t(locale, input.titleKey, input.vars ?? {});
    const body = input.bodyKey ? t(locale, input.bodyKey, input.vars ?? {}) : "";

    const deepLink =
      input.deepLink && isSafeDeepLink(input.deepLink) ? input.deepLink : "/notifications";

    // 1 ── source of truth. If this throws, nothing else runs: a notification
    // the user cannot find in the app afterwards is worse than none at all.
    await query(
      `INSERT INTO notifications (user_id, kind, title, body, href, deep_link, data, collapse_key, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.userId,
        input.kind,
        title,
        body || null,
        deepLink,
        deepLink,
        input.data ? JSON.stringify(input.data) : null,
        input.collapseKey ?? null,
        locale,
      ],
    );

    // 2 ── open app
    await notifyUsers([input.userId], {
      type: "notification",
      kind: input.kind,
      title,
      body,
      deepLink,
      data: input.data ?? {},
    });

    const wire = JSON.stringify({
      title,
      body,
      kind: input.kind,
      href: deepLink,
      deepLink,
      timestamp: Date.now(),
    });

    // 3, 4 ── closed app. Independent: a dead web subscription must not stop
    // the phone from being told.
    await Promise.allSettled([
      sendWebPush(input.userId, wire),
      sendFcm(input.userId, {
        title,
        body,
        kind: input.kind,
        deepLink,
        data: input.data ?? {},
        collapseKey: input.collapseKey,
      }),
    ]);
  } catch (err) {
    console.error("dispatchNotification failed:", (err as Error).message);
  }
}
