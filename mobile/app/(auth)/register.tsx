/**
 * Registration screen.
 *
 * Creates the Firebase account, then calls /auth/register-profile to
 * create the Postgres profile. If profile creation fails, the client
 * must delete the Firebase user (§7).
 */

import { useState } from "react";
import { View, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { Link, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuthActions } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Button } from "@/src/components/ui";
import { MIN_TOUCH } from "@/src/theme/tokens";

const ROLES = [
  { value: "student", label: "Student" },
  { value: "mentor", label: "Mentor" },
  { value: "employer", label: "Employer" },
] as const;

export default function RegisterScreen() {
  const { signUp } = useAuthActions();
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"student" | "mentor" | "employer">("student");
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!fullName.trim() || !email.trim() || !password) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }
    if (password.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      // Account creation and the profile write are one operation as far as this
      // screen is concerned. AuthContext.signUp owns the rollback: if the
      // profile write fails it deletes the Firebase account, because otherwise
      // the user is left with credentials that authenticate to nothing and an
      // email address they can no longer register with.
      await signUp({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        role,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      router.replace("/(app)");
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === "auth/email-already-in-use") {
        Alert.alert("Email taken", "An account already exists with this email.");
      } else if (error.code === "auth/weak-password") {
        Alert.alert("Weak password", "Choose a password of at least 8 characters.");
      } else if (error.code === "auth/network-request-failed") {
        Alert.alert(
          "No connection",
          "We could not reach GlobalBridge. Your account was not created — try again when you have signal.",
        );
      } else {
        Alert.alert(
          "We could not finish signing you up",
          error.message ?? "Nothing was saved. Please try again.",
        );
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
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: space.xl,
          paddingTop: insets.top + space.xxl,
          paddingBottom: insets.bottom + space.xxl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <GBText variant="display" style={{ textAlign: "center", marginBottom: space.xs }}>
          Create Account
        </GBText>
        <GBText variant="body" tone="muted" style={{ textAlign: "center", marginBottom: space.xl }}>
          Start your immigration journey.
        </GBText>

        <View style={{ gap: space.md }}>
          <TextInput
            style={inputStyle}
            placeholder="Full name"
            placeholderTextColor={colors.ink5}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            autoComplete="name"
            accessibilityLabel="Full name"
          />
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
            placeholder="Password (min 8 characters)"
            placeholderTextColor={colors.ink5}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            accessibilityLabel="Password"
          />

          <GBText variant="label" tone="muted" style={{ marginTop: space.xs }}>
            I am a...
          </GBText>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            {ROLES.map((r) => {
              const active = r.value === role;
              return (
                <Pressable
                  key={r.value}
                  onPress={() => setRole(r.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={{
                    flex: 1,
                    minHeight: MIN_TOUCH,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.md,
                    backgroundColor: active ? colors.claysoft : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? colors.clay : colors.border,
                  }}
                >
                  <GBText variant="label" style={{ color: active ? colors.clay6 : colors.ink6 }}>
                    {r.label}
                  </GBText>
                </Pressable>
              );
            })}
          </View>

          <Button
            label={loading ? "Creating account..." : "Create Account"}
            onPress={() => void handleRegister()}
            loading={loading}
            style={{ marginTop: space.xs }}
          />
        </View>

        <Link href="/(auth)/login" asChild>
          <Pressable style={{ marginTop: space.xl, alignItems: "center" }}>
            <GBText variant="small" tone="muted">
              Already have an account? <GBText variant="small" tone="brand">Sign in</GBText>
            </GBText>
          </Pressable>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
