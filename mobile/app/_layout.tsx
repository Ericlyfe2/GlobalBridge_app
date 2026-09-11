import React from "react";
import { View, ActivityIndicator, Linking } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth, useAuthActions } from "@/src/contexts/AuthContext";
import { ThemeProvider, useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Button } from "@/src/components/ui";
import { AnimatedSplash } from "@/src/components/AnimatedSplash";

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

/**
 * 503 server/maintenance — the whole API is down for everyone, not just this
 * account. "Try again" re-checks the session rather than reloading the app,
 * since the window closing is not a Firebase event the auth listener would
 * ever see on its own.
 */
function MaintenanceScreen({ retryAfterSeconds }: { retryAfterSeconds: number }) {
  const { colors, space } = useTheme();
  const { retryConnection } = useAuthActions();
  const [retrying, setRetrying] = React.useState(false);

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
        GlobalBridge is briefly unavailable
      </GBText>
      <GBText variant="body" tone="muted" style={{ textAlign: "center" }}>
        We are making an update. This usually takes a few minutes — nothing
        you have saved is affected.
      </GBText>
      <Button
        label={retrying ? "Checking…" : "Try again"}
        loading={retrying}
        onPress={async () => {
          setRetrying(true);
          try {
            await retryConnection();
          } finally {
            setRetrying(false);
          }
        }}
        style={{ marginTop: space.sm, alignSelf: "stretch" }}
      />
      {retryAfterSeconds ? (
        <GBText variant="small" tone="subtle">
          Usually back within a few minutes
        </GBText>
      ) : null}
    </View>
  );
}

function Gate() {
  const state = useAuth();
  const { colors, isDark } = useTheme();
  const [splashDone, setSplashDone] = React.useState(false);

  if (!splashDone) {
    return (
      <AnimatedSplash ready={state.status !== "loading"} onFinish={() => setSplashDone(true)} />
    );
  }

  if (state.status === "update-required") {
    return (
      <>
        <StatusBar style={isDark ? "light" : "dark"} />
        <UpdateRequiredScreen url={state.info.updateUrl} latest={state.info.latestVersion} />
      </>
    );
  }

  if (state.status === "maintenance") {
    return (
      <>
        <StatusBar style={isDark ? "light" : "dark"} />
        <MaintenanceScreen retryAfterSeconds={state.retryAfterSeconds} />
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
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: "fade",
        }}
      >
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
