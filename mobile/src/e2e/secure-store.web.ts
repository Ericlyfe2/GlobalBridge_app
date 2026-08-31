/**
 * Web-only expo-secure-store shim.
 *
 * expo-secure-store is native-only. Metro resolves this file in place of the
 * package for `web` builds only (see metro.config.js). localStorage is a
 * reasonable stand-in for the keychain in a browser E2E build: it is scoped to
 * the origin and cleared per test context by Playwright.
 */
import { Platform } from "react-native";

if (Platform.OS !== "web") {
  throw new Error("secure-store.web.ts must only be bundled for the web platform");
}

const PREFIX = "gb.secure.";

export async function getItemAsync(key: string): Promise<string | null> {
  return globalThis.localStorage?.getItem(PREFIX + key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  globalThis.localStorage?.setItem(PREFIX + key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  globalThis.localStorage?.removeItem(PREFIX + key);
}

export async function canUseBiometricAuthentication(): Promise<boolean> {
  return false;
}