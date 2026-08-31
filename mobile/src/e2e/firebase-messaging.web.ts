/**
 * Web-only Firebase Messaging shim.
 *
 * @react-native-firebase/messaging is a native module and cannot run in a
 * browser. Metro resolves this file in place of the package for `web` builds
 * only (see metro.config.js). Push registration is never exercised in the E2E
 * suite, so every method is a harmless no-op that never throws.
 */
import { Platform } from "react-native";

if (Platform.OS !== "web") {
  throw new Error("firebase-messaging.web.ts must only be bundled for the web platform");
}

const AuthorizationStatus = {
  NOT_DETERMINED: -1,
  DENIED: 0,
  AUTHORIZED: 1,
  PROVISIONAL: 2,
} as const;

type Messaging = {
  hasPermission: () => Promise<number>;
  requestPermission: () => Promise<number>;
  getToken: () => Promise<string | null>;
  onTokenRefresh: (callback: (token: string) => void) => () => void;
};

const messaging: Messaging = {
  async hasPermission() {
    return AuthorizationStatus.DENIED;
  },
  async requestPermission() {
    return AuthorizationStatus.DENIED;
  },
  async getToken() {
    return null;
  },
  onTokenRefresh() {
    return () => {};
  },
};

export default messaging;
export { AuthorizationStatus };