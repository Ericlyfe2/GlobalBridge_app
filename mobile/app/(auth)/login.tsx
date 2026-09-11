/**
 * Login screen.
 *
 * Email + password via Firebase Auth. The architecture doc (§7) explains
 * why `auth/revoked` and `auth/invalid-token` are distinguished at the API
 * level — this screen shows the session-ended state for the former.
 */

import { useEffect, useRef, useState } from "react";
import {
  View,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Animated,
} from "react-native";
import { Link } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuthActions } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Button } from "@/src/components/ui";
import { AuthHero } from "@/src/components/AuthHero";
import { ThemeToggleButton } from "@/src/components/ThemeToggleButton";

export default function LoginScreen() {
  const { signIn, signInWithGoogle, resetPassword } = useAuthActions();
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const outcome = await signInWithGoogle();
      // "cancelled" is the user closing the picker — not an error to surface.
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

  const handleForgotPassword = () => {
    if (!email.trim()) {
      Alert.alert("Enter your email", "Type your email above first, then tap “Forgot password” again.");
      return;
    }
    Alert.alert(
      "Reset password",
      `Send a password reset link to ${email.trim()}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send link",
          onPress: async () => {
            try {
              await resetPassword(email.trim());
              Alert.alert("Check your inbox", "We sent a password reset link to your email.");
            } catch (err: unknown) {
              const error = err as { code?: string; message?: string };
              if (error.code === "auth/user-not-found") {
                Alert.alert("Account not found", "No account exists with this email.");
              } else {
                Alert.alert("Could not send link", error.message ?? "Please try again.");
              }
            }
          },
        },
      ],
    );
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
          <AuthHero height={Math.max(200, insets.top + 220)} />
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
            Login to Access Your Journey
          </GBText>
          <GBText variant="body" tone="muted" style={{ textAlign: "center", marginBottom: space.xl }}>
            Scholarships, housing, and visa guidance in one place.
          </GBText>

          <View style={{ gap: space.md }}>
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
                placeholder="Password"
                placeholderTextColor={colors.ink5}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="password"
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

            <Pressable onPress={handleForgotPassword} style={{ alignSelf: "flex-end" }} hitSlop={8}>
              <GBText variant="small" tone="brand">
                Forgot password?
              </GBText>
            </Pressable>

            <Button
              label={loading ? "Signing in..." : "Login"}
              onPress={() => void handleLogin()}
              loading={loading}
              style={{ marginTop: space.xs }}
            />

            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.sm }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              <GBText variant="small" tone="subtle">
                or sign in with
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
                  Alert.alert("Coming soon", "Sign in with Apple isn't available yet — use email or Google for now.")
                }
                accessibilityLabel="Continue with Apple"
              />
            </View>
          </View>

          <Link href="/(auth)/register" asChild>
            <Pressable style={{ marginTop: space.xl, alignItems: "center" }}>
              <GBText variant="small" tone="muted">
                Don't have an account? <GBText variant="small" tone="brand">Create an account</GBText>
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
