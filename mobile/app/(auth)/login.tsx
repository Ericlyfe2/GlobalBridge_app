/**
 * Login screen.
 *
 * Email + password via Firebase Auth. The architecture doc (§7) explains
 * why `auth/revoked` and `auth/invalid-token` are distinguished at the API
 * level — this screen shows the session-ended state for the former.
 */

import { useState } from "react";
import { View, TextInput, Alert, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { Link } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuthActions } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Button } from "@/src/components/ui";

export default function LoginScreen() {
  const { signIn } = useAuthActions();
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert("Error", "Please enter your email and password.");
      return;
    }

    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === "auth/user-not-found") {
        Alert.alert("Account not found", "No account exists with this email.");
      } else if (error.code === "auth/wrong-password") {
        Alert.alert("Wrong password", "Please check your password and try again.");
      } else if (error.code === "auth/too-many-requests") {
        Alert.alert("Too many attempts", "Please try again later.");
      } else {
        Alert.alert("Login failed", error.message ?? "An unexpected error occurred.");
      }
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    color: colors.ink,
    fontSize: 16,
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          paddingHorizontal: space.xl,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <GBText variant="display" style={{ textAlign: "center", marginBottom: space.xs }}>
          GlobalBridge
        </GBText>
        <GBText variant="body" tone="muted" style={{ textAlign: "center", marginBottom: space.xxl }}>
          Your immigration journey, simplified.
        </GBText>

        <View style={{ gap: space.md }}>
          <TextInput
            style={inputStyle}
            placeholder="Email"
            placeholderTextColor={colors.ink5}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            accessibilityLabel="Email"
          />
          <TextInput
            style={inputStyle}
            placeholder="Password"
            placeholderTextColor={colors.ink5}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            accessibilityLabel="Password"
          />

          <Button
            label={loading ? "Signing in..." : "Sign In"}
            onPress={() => void handleLogin()}
            loading={loading}
            style={{ marginTop: space.xs }}
          />
        </View>

        <Link href="/(auth)/register" asChild>
          <Pressable style={{ marginTop: space.xl, alignItems: "center" }}>
            <GBText variant="small" tone="muted">
              Don't have an account? <GBText variant="small" tone="brand">Sign up</GBText>
            </GBText>
          </Pressable>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}
