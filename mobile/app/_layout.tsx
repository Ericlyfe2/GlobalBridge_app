import React from "react";
import { View, ActivityIndicator, Linking } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth, useAuthActions } from "@/src/contexts/AuthContext";
import { ThemeProvider, useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Button } from "@/src/components/ui";

/**
 * Root layout.
 *
 * Three states are handled here rather than inside any screen, because all
 * three mean "no screen should render": the app is still deciding who you are,
 * this build is refused by the server, or your session ended underneath you.
 */

/**
 * 426 — the server refuses this build.
 *
 * Blocking and translated, never a raw error. The gate exists because a mobile
 * binary can sit unchanged on a phone for months, so an old client can outlive
 * the contract it was written against; the user did nothing wrong and the
 * screen says so.
 *
 * There is no dismiss. A build below the floor cannot make a useful request,
 * and a dismissable version of this screen is just a slower way to show a
 * broken app.
 */
function UpdateRequiredScreen({ url, latest }: { url: string; latest: string }) {
  const { colors, space } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: space.xl,
        gap: space.md,
      }}
    >
      <GBText variant="title" style={{ textAlign: "center" }}>
        Time to update GlobalBridge
      </GBText>
      <GBText variant="body" tone="muted" style={{ textAlign: "center" }}>
        This version can no longer connect safely. Updating takes a moment and
        keeps your documents and messages secure.
      </GBText>
      {latest ? (
        <GBText variant="small" tone="subtle">
          Latest version {latest}
        </GBText>
      ) : null}
      <Button
        label="Update now"
        onPress={() => {
          if (url) void Linking.openURL(url);
        }}
        style={{ marginTop: space.sm, alignSelf: "stretch" }}
      />
    </View>
  );
}

/** The account was suspended, deleted, or signed out elsewhere. */
function SessionEndedScreen() {
  const { colors, space } = useTheme();
  const { signOut } = useAuthActions();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: space.xl,
        gap: space.md,
      }}
    >
      <GBText variant="title" style={{ textAlign: "center" }}>
        You have been signed out
      </GBText>
      <GBText variant="body" tone="muted" style={{ textAlign: "center" }}>
        Your session ended. Sign in again to pick up where you left off — nothing
        has been lost.
      </GBText>
      <Button
        label="Sign in"
        onPress={() => void signOut()}
        style={{ marginTop: space.sm, alignSelf: "stretch" }}
      />
    </View>
  );
}

function Gate() {
  const state = useAuth();
  const { colors, isDark } = useTheme();

  if (state.status === "update-required") {
    return (
      <>
        <StatusBar style={isDark ? "light" : "dark"} />
        <UpdateRequiredScreen url={state.info.updateUrl} latest={state.info.latestVersion} />
      </>
    );
  }

  if (state.status === "session-ended") {
    return (
      <>
        <StatusBar style={isDark ? "light" : "dark"} />
        <SessionEndedScreen />
      </>
    );
  }

  if (state.status === "loading") {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color={colors.clay} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
