import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import auth, { type FirebaseAuthTypes } from "@react-native-firebase/auth";
import { configureApi, APP_VERSION, type UpdateRequired } from "../api/client";
import {
  fetchMe,
  fetchAppConfig,
  registerProfile,
  unregisterDeviceToken,
  type Profile,
} from "../api/endpoints";
import {
  getDeviceToken,
  clearDeviceToken,
  getPermissionStatus,
  registerCurrentToken,
  watchTokenRefresh,
} from "../services/push";
import { clearLocalCache } from "../services/storage";
import { signInWithGoogle as runGoogleSignIn, type GoogleSignInOutcome } from "../services/googleAuth";

/** `"1.2.10" < "1.3.0"` semver compare, good enough for a three-part version string. */
function versionBelow(current: string, floor: string): boolean {
  const a = current.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * Authentication.
 *
 * Firebase owns credentials; the API owns the profile; `users.firebase_uid`
 * joins them. This context is the only place the app touches Firebase Auth
 * directly.
 */

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "needs-profile"; user: FirebaseAuthTypes.User }
  | { status: "signed-in"; user: FirebaseAuthTypes.User; profile: Profile }
  | { status: "session-ended" }
  | { status: "update-required"; info: UpdateRequired }
  | { status: "maintenance"; retryAfterSeconds: number };

type AuthActions = {
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<GoogleSignInOutcome>;
  signUp: (input: {
    email: string;
    password: string;
    fullName: string;
    role?: "student" | "mentor" | "employer";
    countryOfOrigin?: string;
    countryOfResidence?: string;
    preferredLanguage?: string;
    timezone?: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  retryConnection: () => Promise<void>;
};

const StateCtx = createContext<AuthState>({ status: "loading" });
const ActionsCtx = createContext<AuthActions | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  // Held in a ref as well as state so the API client's callbacks can read the
  // current value without being re-registered on every render.
  const stateRef = useRef<AuthState>(state);
  stateRef.current = state;

  /**
   * Token accessor handed to the API client.
   *
   * `force` is passed straight through to Firebase: false returns the cached
   * token, true costs a network round trip. The client sends false on the way
   * out and true exactly once on a 401.
   */
  const getToken = useCallback(async (force: boolean): Promise<string | null> => {
    const user = auth().currentUser;
    if (!user) return null;
    try {
      return await user.getIdToken(force);
    } catch {
      // Offline, or Firebase unreachable. Returning null lets the request fail
      // as a network error rather than as an auth error, which is the honest
      // description and keeps the user signed in.
      return null;
    }
  }, []);

  useEffect(() => {
    configureApi({
      getToken,
      onSessionEnded: () => setState({ status: "session-ended" }),
      onUpdateRequired: (info) => setState({ status: "update-required", info }),
      onMaintenance: (retryAfterSeconds) => setState({ status: "maintenance", retryAfterSeconds }),
    });
  }, [getToken]);

  const loadProfile = useCallback(async (user: FirebaseAuthTypes.User) => {
    try {
      const { user: profile, profileComplete } = await fetchMe();
      setState(
        profileComplete
          ? { status: "signed-in", user, profile }
          : { status: "needs-profile", user },
      );
    } catch (err) {
      // A 404 means the Firebase account exists with no profile behind it —
      // signup was interrupted between the two steps. Send them through the
      // profile step rather than to a broken home screen.
      const status = (err as { status?: number }).status;
      if (status === 404) {
        setState({ status: "needs-profile", user });
        return;
      }
      // The update-required, maintenance and session-ended cases have already
      // been set by the client's interceptor; do not overwrite them.
      if (stateRef.current.status === "update-required") return;
      if (stateRef.current.status === "maintenance") return;
      if (stateRef.current.status === "session-ended") return;
      throw err;
    }
  }, []);

  const checkSession = useCallback(
    async (user: FirebaseAuthTypes.User | null) => {
      if (!user) {
        setState({ status: "signed-out" });
        return;
      }
      await loadProfile(user).catch(() => {
        // Could not reach the API at all. The Firebase session is still valid,
        // so keep them signed in and let the offline banner explain.
        setState({ status: "needs-profile", user });
      });
    },
    [loadProfile],
  );

  useEffect(() => {
    const unsubscribe = auth().onAuthStateChanged((user) => void checkSession(user));
    return unsubscribe;
  }, [checkSession]);

  /**
   * Maintenance mode and the version floor are otherwise only discovered
   * reactively, on the first authenticated request — which means a signed-out
   * user sitting on the login screen would type a password into a form the
   * server is about to refuse. Called once at launch so that gate shows up
   * front instead, and again from `retryConnection` so leaving the gate always
   * re-confirms the server is actually back rather than just clearing itself.
   *
   * Returns whether a gate was set — `retryConnection` uses that to decide
   * whether it is still safe to fall through to `checkSession`.
   */
  const checkAppConfig = useCallback(async (): Promise<boolean> => {
    try {
      const config = await fetchAppConfig(true);
      if (config.maintenanceMode) {
        setState({ status: "maintenance", retryAfterSeconds: 300 });
        return true;
      }
      if (versionBelow(APP_VERSION, config.minSupportedVersion)) {
        setState({
          status: "update-required",
          info: {
            minSupportedVersion: config.minSupportedVersion,
            latestVersion: config.latestVersion,
            updateUrl: config.updateUrl,
          },
        });
        return true;
      }
      return false;
    } catch {
      // Offline or unreachable. Not itself a gate — the auth listener's own
      // state and the app's offline banner cover this case.
      return false;
    }
  }, []);

  useEffect(() => {
    void checkAppConfig();
    // Deliberately once per app launch, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Re-registers the FCM token on sign-in, and keeps it current across FCM's
   * own rotations. Silent by construction: it only ever calls
   * `getPermissionStatus`/`registerCurrentToken`, never `enablePush` — the
   * permission prompt itself is push.ts's one deliberately-user-triggered
   * action, from the Notifications row in Settings. A reinstall, a token that
   * rotated while the app was closed, or simply the last-known token going
   * stale all need this on every sign-in even though nothing here ever asks
   * for permission again.
   */
  useEffect(() => {
    if (state.status !== "signed-in") return;
    const locale = state.profile.preferred_language ?? "en";
    let unwatch: (() => void) | undefined;

    getPermissionStatus().then((status) => {
      if (status !== "granted") return;
      void registerCurrentToken(locale);
      unwatch = watchTokenRefresh(locale);
    });

    return () => unwatch?.();
  }, [state.status === "signed-in" ? state.profile.preferred_language : null, state.status]);

  /**
   * Leaves the maintenance/update-required gate once the server is reachable
   * again. Re-checks config first — a signed-out user retrying mid-maintenance
   * must not fall straight into `checkSession`'s unconditional "signed-out",
   * which would clear the gate whether or not the server actually recovered.
   */
  const retryConnection = useCallback(async () => {
    const gated = await checkAppConfig();
    if (gated) return;
    await checkSession(auth().currentUser);
  }, [checkAppConfig, checkSession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const cred = await auth().signInWithEmailAndPassword(email.trim(), password);
      await loadProfile(cred.user);
    },
    [loadProfile],
  );

  const signInWithGoogle = useCallback(async (): Promise<GoogleSignInOutcome> => {
    const outcome = await runGoogleSignIn();
    if (outcome === "signed-in") {
      const user = auth().currentUser;
      if (user) await loadProfile(user);
    }
    return outcome;
  }, [loadProfile]);

  /**
   * Sign up, with the rollback that keeps the two systems consistent.
   *
   * ── The orphaned-identity trap ────────────────────────────────────────
   * Account creation is two writes in two systems. If the Firebase account is
   * created and the profile write then fails — bad network, server down, a 500
   * — the user is left with credentials that authenticate to nothing. They
   * cannot sign in to anything useful, and they cannot sign up again either,
   * because the email address is now taken.
   *
   * Deleting the Firebase user on failure is the only thing that returns them
   * to a state they can act from. It has to happen on the client because the
   * client is the only party holding a credential for that brand-new account.
   */
  const signUp = useCallback<AuthActions["signUp"]>(async (input) => {
    const cred = await auth().createUserWithEmailAndPassword(
      input.email.trim(),
      input.password,
    );

    try {
      // Force a token: the account was created moments ago and the SDK may not
      // have one cached yet.
      await cred.user.getIdToken(true);

      await registerProfile({
        full_name: input.fullName,
        role: input.role ?? "student",
        country_of_origin: input.countryOfOrigin,
        country_of_residence: input.countryOfResidence,
        preferred_language: input.preferredLanguage,
        timezone: input.timezone,
      });

      await loadProfile(cred.user);
    } catch (err) {
      try {
        await cred.user.delete();
      } catch {
        // Deletion itself failed — rare, and there is nothing further the
        // client can do. Surfacing the original error is more useful than
        // surfacing this one.
      }
      throw err;
    }
  }, [loadProfile]);

  /**
   * Sign out.
   *
   * Order matters and is not interchangeable:
   *
   *   1. Unregister the device token — needs a *valid* session, so it must
   *      happen before Firebase is signed out. Skipping it means the next
   *      person to use this phone gets the previous user's notifications.
   *   2. Clear the local cache — a shared or lost phone is exactly the case
   *      the offline store has to survive, so it is cleared, not invalidated.
   *   3. Sign out of Firebase.
   *
   * Steps 1 and 2 are best-effort: a failure there must not trap someone in a
   * signed-in state they are trying to leave.
   */
  const signOut = useCallback(async () => {
    const token = await getDeviceToken().catch(() => null);
    if (token) {
      await unregisterDeviceToken(token).catch(() => undefined);
      await clearDeviceToken().catch(() => undefined);
    }
    await clearLocalCache().catch(() => undefined);
    await auth().signOut();
    setState({ status: "signed-out" });
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await auth().sendPasswordResetEmail(email.trim());
  }, []);

  const refreshProfile = useCallback(async () => {
    const user = auth().currentUser;
    if (user) await loadProfile(user);
  }, [loadProfile]);

  const actions = useMemo<AuthActions>(
    () => ({ signIn, signInWithGoogle, signUp, signOut, resetPassword, refreshProfile, retryConnection }),
    [signIn, signInWithGoogle, signUp, signOut, resetPassword, refreshProfile, retryConnection],
  );

  return (
    <StateCtx.Provider value={state}>
      <ActionsCtx.Provider value={actions}>{children}</ActionsCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(StateCtx);
}

export function useAuthActions(): AuthActions {
  const actions = useContext(ActionsCtx);
  if (!actions) throw new Error("useAuthActions must be used inside <AuthProvider>");
  return actions;
}
