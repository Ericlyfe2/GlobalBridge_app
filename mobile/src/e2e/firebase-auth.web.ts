/**
 * Web-only Firebase Auth shim.
 *
 * @react-native-firebase/auth is a native module and cannot run in a browser.
 * Metro resolves this file in place of the package for `web` platform builds
 * only (see metro.config.js). It implements the exact surface the app uses so
 * the E2E suite can drive the real screens.
 *
 * ── Deterministic behaviour for tests ──────────────────────────────────────
 * There is no real Firebase project behind this build, so identity is faked and
 * the rules are chosen to exercise every auth branch in the UI:
 *
 *   student@globalbridge.test  -> known account, signs in
 *   new@globalbridge.test      -> known account, no profile yet
 *                                (the /auth/me mock 404s -> onboarding)
 *   wrong-password             -> auth/wrong-password
 *   any other email            -> auth/user-not-found
 *
 * The ID token returned by getIdToken encodes the email so Playwright's route
 * mocks (which intercept the API, not the bundle) can tell the two accounts
 * apart and return a complete profile or a 404 accordingly.
 */
import { Platform } from "react-native";
import { installWebAlertPatch } from "./alert-patch.web";

if (Platform.OS !== "web") {
  throw new Error("firebase-auth.web.ts must only be bundled for the web platform");
}

// Restore react-native-web's no-op Alert so validation errors and destructive
// confirmations surface in the browser (the E2E suite drives them).
installWebAlertPatch();

export type E2eUser = {
  uid: string;
  email: string;
  getIdToken: (force?: boolean) => Promise<string>;
  delete: () => Promise<{ uid: string }>;
};

type AuthListener = (user: E2eUser | null) => void;

type AuthImpl = {
  readonly currentUser: E2eUser | null;
  onAuthStateChanged: (listener: AuthListener) => () => void;
  signInWithEmailAndPassword: (email: string, password: string) => Promise<{ user: E2eUser }>;
  createUserWithEmailAndPassword: (email: string, password: string) => Promise<{ user: E2eUser }>;
  signOut: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
};

function firebaseError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

let currentUser: E2eUser | null = null;
const listeners = new Set<AuthListener>();

function notify(): void {
  listeners.forEach((listener) => listener(currentUser));
}

function makeUser(email: string): E2eUser {
  const uid = `e2e-${email.replace(/[^a-z0-9@.]/gi, "-")}`;
  return {
    uid,
    email,
    getIdToken: async () => `e2e-token:${email}`,
    delete: async () => ({ uid }),
  };
}

const KNOWN_ACCOUNTS = new Set(["student@globalbridge.test", "new@globalbridge.test"]);

function signInWithEmailAndPassword(email: string, password: string) {
  const normalized = email.trim().toLowerCase();

  if (password === "wrong-password") {
    throw firebaseError(
      "auth/wrong-password",
      "The password is invalid or the user does not have a password.",
    );
  }
  if (!KNOWN_ACCOUNTS.has(normalized)) {
    throw firebaseError(
      "auth/user-not-found",
      "There is no user record corresponding to this identifier.",
    );
  }

  const user = makeUser(normalized);
  currentUser = user;
  notify();
  return Promise.resolve({ user });
}

const auth = ((): AuthImpl => {
  return {
    get currentUser() {
      return currentUser;
    },
    onAuthStateChanged(listener: AuthListener) {
      listeners.add(listener);
      // Firebase fires the listener immediately with the current session.
      queueMicrotask(() => listener(currentUser));
      return () => listeners.delete(listener);
    },
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword(email: string) {
      const user = makeUser(email.trim().toLowerCase());
      currentUser = user;
      notify();
      return Promise.resolve({ user });
    },
    signOut() {
      currentUser = null;
      notify();
      return Promise.resolve();
    },
    sendPasswordResetEmail() {
      return Promise.resolve();
    },
  };
})();

export default auth;

/** Namespace kept for parity with the real package's value exports. */
export const FirebaseAuthTypes = {};