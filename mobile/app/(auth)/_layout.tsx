/**
 * Auth layout.
 *
 * Shown when the user is not signed in. Redirects to the app if they are.
 */

import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { View, ActivityIndicator } from "react-native";

export default function AuthLayout() {
  const authState = useAuth();
  const { colors } = useTheme();

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

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
    </Stack>
  );
}
