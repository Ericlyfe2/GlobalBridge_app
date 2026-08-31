import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

/**
 * Local cache.
 *
 * ── What may be cached ────────────────────────────────────────────────────
 * Reference data, lists the user has already loaded, message history, and
 * checklist state. That is the same list the server's `/sync` endpoint returns,
 * and it is not a coincidence: the two have to agree about what is cacheable.
 *
 * ── What may never be cached ──────────────────────────────────────────────
 * AI responses, documents, and credentials.
 *
 * The AI rule is the one that looks over-cautious and is not. Guidance is
 * generated against a knowledge base and admin config that change; a cached
 * answer about a visa fee keeps looking authoritative long after it stopped
 * being true, and the client has no way to know when that happened. A stale
 * spinner is a worse experience for ten seconds. A stale fee is a rejected
 * application.
 *
 * Documents are served through short-lived signed URLs precisely so no
 * unmanaged copy exists; writing one into a local database would undo that.
 *
 * ── Why sign-out clears rather than invalidates ───────────────────────────
 * On native the store is app-scoped, so the shared-browser leak does not apply.
 * A shared *phone* very much does for this audience, and so does a lost one.
 * Clearing is the only thing that survives both.
 */

const CACHE_PREFIX = "gb.cache.";
const SYNC_CURSOR_KEY = "gb.sync.cursor";

/** Keys that must never appear under the cache prefix. Enforced below. */
const FORBIDDEN = ["token", "idToken", "document", "signedUrl", "ai.", "password"];

function assertCacheable(key: string): void {
  const lowered = key.toLowerCase();
  for (const banned of FORBIDDEN) {
    if (lowered.includes(banned.toLowerCase())) {
      throw new Error(
        `Refusing to cache "${key}": matches the never-cache list (${banned}). ` +
          `See src/services/storage.ts for why.`,
      );
    }
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  assertCacheable(key);
  await AsyncStorage.setItem(
    CACHE_PREFIX + key,
    JSON.stringify({ at: Date.now(), value }),
  );
}

export type Cached<T> = { value: T; at: number } | null;

/**
 * Read a cached value along with when it was written.
 *
 * The timestamp is returned rather than hidden because the offline design calls
 * for it: a screen showing stale data has to say *how* stale. "Showing saved
 * data from 09:14" is honest and useful; the same data with no label is a lie
 * of omission, and a spinner that never resolves is worse than both.
 */
export async function cacheGet<T>(key: string): Promise<Cached<T>> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; value: T };
    return { value: parsed.value, at: parsed.at };
  } catch {
    return null;
  }
}

export async function getSyncCursor(): Promise<string | null> {
  return AsyncStorage.getItem(SYNC_CURSOR_KEY);
}

const THEME_MODE_KEY = "gb.theme.mode";

/**
 * The explicit light/dark override ThemeProvider's own design promises from
 * Settings. Deliberately outside `CACHE_PREFIX` and untouched by
 * `clearLocalCache`: how a phone's screen should look is a property of the
 * phone, not of whichever account happens to be signed in on it.
 */
export async function getThemeMode(): Promise<"light" | "dark" | "system" | null> {
  const raw = await AsyncStorage.getItem(THEME_MODE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : null;
}

export async function setThemeMode(mode: "light" | "dark" | "system"): Promise<void> {
  await AsyncStorage.setItem(THEME_MODE_KEY, mode);
}

export async function setSyncCursor(cursor: string): Promise<void> {
  await AsyncStorage.setItem(SYNC_CURSOR_KEY, cursor);
}

/** Everything this install holds for the signed-in user. Called on sign-out. */
export async function clearLocalCache(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const ours = keys.filter((k) => k.startsWith(CACHE_PREFIX) || k === SYNC_CURSOR_KEY);
  if (ours.length) await AsyncStorage.multiRemove(ours);

  // Anything held in the keychain that is not the FCM token, which sign-out
  // handles separately because it needs a live session to unregister first.
  await SecureStore.deleteItemAsync("gb.biometric.enabled").catch(() => undefined);
}
