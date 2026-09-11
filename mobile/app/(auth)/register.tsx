/**
 * Registration screen.
 *
 * Creates the Firebase account, then calls /auth/register-profile to
 * create the Postgres profile. If profile creation fails, the client
 * must delete the Firebase user (§7).
 */

import { useEffect, useRef, useState } from "react";
import {
  View,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  Animated,
} from "react-native";
import { Link, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuthActions } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Button } from "@/src/components/ui";
import { AuthHero } from "@/src/components/AuthHero";
import { ThemeToggleButton } from "@/src/components/ThemeToggleButton";
import { MIN_TOUCH } from "@/src/theme/tokens";

const ROLES = [
  { value: "student", label: "Student" },
  { value: "mentor", label: "Mentor" },
  { value: "employer", label: "Employer" },
] as const;

export default function RegisterScreen() {
  const { signUp, signInWithGoogle } = useAuthActions();
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<"student" | "mentor" | "employer">("student");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const cardAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(cardAnim, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [cardAnim]);

  // A Google account with no profile behind it lands on `needs-profile` and
  // goes to onboarding — including its own "I am a..." step — so there is no
  // role picker to wire up here; it is the same one-tap flow as login.tsx.
  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const outcome = await signInWithGoogle();
      if (outcome === "unavailable") {
        Alert.alert("Google Play Services unavailable", "Google Sign-In needs Google Play Services on this device.");
      }
    } catch (err: unknown) {
      const error = err as { message?: string };
      Alert.alert("Google sign-in failed", error.message ?? "An unexpected error occurred.");
    } finally {
      setGoogleLoading(false);
    }
  };

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

  const inputWrap = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.alt,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
  };
  const inputStyle = {
    flex: 1,
    height: 52,
    color: colors.ink,
    fontSize: 16,
    marginLeft: space.sm,
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ThemeToggleButton />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={{ paddingTop: insets.top }}>
          <AuthHero height={Math.max(160, insets.top + 170)} />
        </View>

        <Animated.View
          style={{
            flex: 1,
            marginTop: -28,
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingHorizontal: space.xl,
            paddingTop: space.xl,
            paddingBottom: insets.bottom + space.xl,
            opacity: cardAnim,
            transform: [
              {
                translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
              },
            ],
          }}
        >
          <GBText variant="title" style={{ textAlign: "center", marginBottom: space.xs }}>
            Create Your Account
          </GBText>
          <GBText variant="body" tone="muted" style={{ textAlign: "center", marginBottom: space.xl }}>
            Start your immigration journey today.
          </GBText>

          <View style={{ gap: space.md }}>
            <View style={inputWrap}>
              <Ionicons name="person-outline" size={18} color={colors.ink5} />
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
            </View>

            <View style={inputWrap}>
              <Ionicons name="mail-outline" size={18} color={colors.ink5} />
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
            </View>

            <View style={inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.ink5} />
              <TextInput
                style={inputStyle}
                placeholder="Password (min 8 characters)"
                placeholderTextColor={colors.ink5}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="new-password"
                accessibilityLabel="Password"
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              >
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={colors.ink5} />
              </Pressable>
            </View>

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
                      backgroundColor: active ? colors.claysoft : colors.alt,
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

            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.sm }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              <GBText variant="small" tone="subtle">
                or sign up with
              </GBText>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            </View>

            <View style={{ flexDirection: "row", justifyContent: "center", gap: space.md }}>
              <SocialCircle
                icon="logo-google"
                loading={googleLoading}
                onPress={() => void handleGoogle()}
                accessibilityLabel="Continue with Google"
              />
              <SocialCircle
                icon="logo-apple"
                onPress={() =>
                  Alert.alert("Coming soon", "Sign up with Apple isn't available yet — use email or Google for now.")
                }
                accessibilityLabel="Continue with Apple"
              />
            </View>
          </View>

          <Link href="/(auth)/login" asChild>
            <Pressable style={{ marginTop: space.xl, alignItems: "center" }}>
              <GBText variant="small" tone="muted">
                Already have an account? <GBText variant="small" tone="brand">Sign in</GBText>
              </GBText>
            </Pressable>
          </Link>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SocialCircle({
  icon,
  onPress,
  loading,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  loading?: boolean;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={loading ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: pressed ? 0.8 : loading ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={22} color={colors.ink7} />
    </Pressable>
  );
}
