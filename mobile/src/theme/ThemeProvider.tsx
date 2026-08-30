import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme, I18nManager } from "react-native";
import { lightColors, darkColors, type ColorTokens, fonts, type, space, radius } from "./tokens";

/**
 * Theme.
 *
 * Follows the OS setting rather than offering an in-app switch as the primary
 * control. A user who has set their phone to dark has already expressed the
 * preference; asking again is a setting nobody wants to manage. An explicit
 * override is still available from Settings for the case the OS gets wrong —
 * chiefly people who keep the phone light but need dark for glare or migraine.
 */

export type ThemeMode = "light" | "dark" | "system";

export type Theme = {
  colors: ColorTokens;
  isDark: boolean;
  fonts: typeof fonts;
  type: typeof type;
  space: typeof space;
  radius: typeof radius;
  /** True when the active locale is right-to-left. */
  isRTL: boolean;
};

const ThemeCtx = createContext<Theme | null>(null);

export function ThemeProvider({
  mode = "system",
  children,
}: {
  mode?: ThemeMode;
  children: React.ReactNode;
}) {
  const scheme = useColorScheme();
  const isDark = mode === "system" ? scheme === "dark" : mode === "dark";

  const value = useMemo<Theme>(
    () => ({
      colors: isDark ? darkColors : lightColors,
      isDark,
      fonts,
      type,
      space,
      radius,
      isRTL: I18nManager.isRTL,
    }),
    [isDark],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeCtx);
  if (!theme) {
    // A component rendering outside the provider would silently get undefined
    // colours and render invisible text on an invisible background, which is
    // far harder to diagnose than this.
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return theme;
}
