import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "../theme/ThemeProvider";
import { MIN_TOUCH } from "../theme/tokens";

/**
 * A quick light/dark toggle for the auth screens.
 *
 * The full picker (light / dark / match device) lives in Profile settings,
 * but that is only reachable once signed in. Someone deciding dark mode is
 * too bright for their eyes shouldn't have to create an account first --
 * this always flips explicitly to the opposite of whatever is showing right
 * now, leaving "match device" as something only the full picker offers.
 */
export function ThemeToggleButton() {
  const { colors, isDark, setMode } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      onPress={() => setMode(isDark ? "light" : "dark")}
      accessibilityRole="button"
      accessibilityLabel={isDark ? "Switch to light mode" : "Switch to dark mode"}
      hitSlop={8}
      style={{
        position: "absolute",
        top: insets.top + 12,
        right: 20,
        zIndex: 10,
        width: MIN_TOUCH,
        height: MIN_TOUCH,
        borderRadius: MIN_TOUCH / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={20} color={colors.ink6} />
    </Pressable>
  );
}
