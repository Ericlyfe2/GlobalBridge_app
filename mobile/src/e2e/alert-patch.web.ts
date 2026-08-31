/**
 * Web-only Alert patch.
 *
 * The app's screens call `Alert.alert` for validation errors and destructive
 * confirmations. react-native-web intentionally ships a no-op Alert, so those
 * flows silently do nothing in a browser. Static methods are looked up on the
 * class at call time, so mutating the class here repairs every screen that
 * imports `Alert` from "react-native".
 *
 * Mirrors the React Native contract closely enough for the app:
 *   - no buttons      -> window.alert(title + message)
 *   - buttons present -> window.confirm; confirming runs the first
 *                        non-cancel button's onPress (cancel never runs).
 */
import { Alert } from "react-native";

export type AlertButton = {
  text?: string;
  onPress?: (value?: string) => void;
  style?: "default" | "cancel" | "destructive";
};

function compose(title?: string, message?: string): string {
  return [title, message].filter(Boolean).join("\n\n");
}

export function installWebAlertPatch(): void {
  const anyAlert = Alert as unknown as {
    alert: (title?: string, message?: string, buttons?: AlertButton[]) => void;
  };

  anyAlert.alert = (
    title?: string,
    message?: string,
    buttons?: AlertButton[],
  ) => {
    const actionable =
      buttons?.find((b) => b.onPress && b.style !== "cancel") ??
      buttons?.find((b) => b.onPress);

    if (!actionable) {
      globalThis.alert?.(compose(title, message));
      return;
    }

    const confirmed = globalThis.confirm?.(compose(title, message));
    if (confirmed) actionable.onPress?.();
  };
}