/**
 * Auth layout.
 *
 * Shown when the user is not signed in. Redirects to the app if they are.
 */

import { Redirect, Stack, useSegments } from "expo-router";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { View, ActivityIndicator } from "react-native";

export default function AuthLayout() {
  const authState = useAuth();
  const { colors } = useTheme();
  const segments = useSegments();

  if (authState.status === "loading") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.clay} />
      </View>
    );
  }

  if (authState.status === "signed-in") {
    return <Redirect href="/(app)" />;
  }

  // Guarded by the current segment: `onboarding` is a sibling screen inside
  // this same layout, so an unconditional Redirect here would re-fire on
  // every re-render once already on that screen -- Redirect navigates even
  // when the destination matches the current route, which becomes an
  // infinite navigate-rerender loop rather than a no-op.
  if (authState.status === "needs-profile" && segments[segments.length - 1] !== "onboarding") {
    return <Redirect href="/(auth)/onboarding" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="onboarding" />
    </Stack>
  );
}
