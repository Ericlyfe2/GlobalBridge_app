import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import auth from "@react-native-firebase/auth";

/**
 * Inlined rather than imported from the library's own `isErrorWithCode`
 * helper: it's a plain one-line predicate (see the library's src/functions.ts),
 * but under this project's release/minify bundling it resolved to `undefined`
 * at runtime -- a production-only failure ("undefined is not a function")
 * never seen in the dev bundle, consistent with a named-export interop edge
 * case for this package under Hermes minification. `response.type === "success"`
 * is checked directly below for the same reason, rather than via the
 * library's `isSuccessResponse`.
 */
function isErrorWithCode(error: unknown): error is { code: string } {
  return (error instanceof Error || (typeof error === "object" && error != null)) && "code" in (error as object);
}

/**
 * Google Sign-In.
 *
 * One credential exchange, not two flows: whether this is someone's first
 * time or their hundredth, `signInWithCredential` either creates the Firebase
 * account or signs into the existing one, and `AuthContext.loadProfile`
 * already handles both outcomes — a fresh Google user lands on `needs-profile`
 * and goes through the same onboarding an email signup would, an existing one
 * goes straight to `signed-in`. Nothing here needs to know which case it is.
 *
 * `webClientId` is the OAuth "Web application" client Firebase generates once
 * Google is enabled as a sign-in provider in the console — not a secret, safe
 * in EXPO_PUBLIC_*, but it does not exist until that console step is done.
 */

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) {
    throw new Error(
      "Google Sign-In is not configured yet: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is unset. " +
        "Enable Google as a sign-in provider in the Firebase console and copy its Web client ID.",
    );
  }
  GoogleSignin.configure({ webClientId });
  configured = true;
}

export type GoogleSignInOutcome = "signed-in" | "cancelled" | "unavailable";

/**
 * Runs the native Google account picker and exchanges the result for a
 * Firebase session. Cancellation is not an error — someone closing the
 * picker is the single most common outcome and must not surface a red alert.
 */
export async function signInWithGoogle(): Promise<GoogleSignInOutcome> {
  ensureConfigured();

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (response.type !== "success") return "cancelled";

    const idToken = response.data.idToken;
    if (!idToken) return "cancelled";

    const credential = auth.GoogleAuthProvider.credential(idToken);
    await auth().signInWithCredential(credential);
    return "signed-in";
  } catch (err) {
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) return "cancelled";
      if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return "unavailable";
    }
    // Anything else -- including UserRecoverableAuthException/BadAuthentication,
    // a real Play-Services-level account problem this library has no status
    // code for -- gets a message a person can act on. The raw native error's
    // own `.message` is not trustworthy here: on a genuinely broken account,
    // Play Services fails before the picker even opens, and what surfaces to
    // JS through this library's own error path is not always a real message
    // (has been seen to literally read "undefined is not a function").
    throw new Error(
      "Google could not verify your account on this device. Try removing and " +
        "re-adding your Google account in Settings, or use email sign-in instead.",
    );
  }
}
