import messaging from "@react-native-firebase/messaging";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { registerDeviceToken } from "../api/endpoints";
import { APP_VERSION } from "../api/client";

/**
 * Native push registration.
 *
 * ── Permission is never requested on load ─────────────────────────────────
 * `requestPermission` is exported and called from an explicit tap in Settings,
 * never from a mount effect. A prompt on first launch, before the user knows
 * what the app is for, is the fastest route to a permanent denial — and on iOS
 * a denial cannot be re-prompted, only sent to the OS settings screen. For a
 * product whose deadline and safety alerts are most of the reason to install
 * it, burning that prompt is expensive and irreversible.
 */

const TOKEN_KEY = "gb.fcm.token";

/** The token this install currently has registered, if any. */
export async function getDeviceToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function clearDeviceToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    /* nothing stored */
  }
}

export type PushPermission = "granted" | "denied" | "undetermined";

export async function getPermissionStatus(): Promise<PushPermission> {
  const status = await messaging().hasPermission();
  if (status === messaging.AuthorizationStatus.AUTHORIZED) return "granted";
  if (status === messaging.AuthorizationStatus.PROVISIONAL) return "granted";
  if (status === messaging.AuthorizationStatus.NOT_DETERMINED) return "undetermined";
  return "denied";
}

/**
 * Ask for permission and register the resulting token.
 *
 * Call this only from a deliberate user action. Returns the resulting status so
 * the Settings row can render honestly — including the denied case, where the
 * only remaining route is the OS settings app and the UI has to say so rather
 * than offering a button that does nothing.
 */
export async function enablePush(locale: string): Promise<PushPermission> {
  const status = await messaging().requestPermission();
  const granted =
    status === messaging.AuthorizationStatus.AUTHORIZED ||
    status === messaging.AuthorizationStatus.PROVISIONAL;

  if (!granted) return "denied";

  await registerCurrentToken(locale);
  return "granted";
}

/** Fetch the current FCM token and tell the server about it. */
export async function registerCurrentToken(locale: string): Promise<string | null> {
  const token = await messaging().getToken();
  if (!token) return null;

  await registerDeviceToken({
    token,
    platform: Platform.OS === "ios" ? "ios" : "android",
    app_version: APP_VERSION,
    locale,
  });

  await SecureStore.setItemAsync(TOKEN_KEY, token);
  return token;
}

/**
 * Keep the server's copy current.
 *
 * FCM rotates tokens on its own schedule — reinstalls, restores, and periodic
 * refreshes. A rotated token that is never re-registered means notifications
 * silently stop, which looks to the user like the feature was removed.
 */
export function watchTokenRefresh(locale: string): () => void {
  return messaging().onTokenRefresh(async (token) => {
    try {
      await registerDeviceToken({
        token,
        platform: Platform.OS === "ios" ? "ios" : "android",
        app_version: APP_VERSION,
        locale,
      });
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    } catch {
      // Retried on the next foreground. Failing here must not crash the app.
    }
  });
}
