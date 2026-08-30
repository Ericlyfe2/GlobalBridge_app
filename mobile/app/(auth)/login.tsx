/**
 * Login screen.
 *
 * Email + password via Firebase Auth. The architecture doc (§7) explains
 * why `auth/revoked` and `auth/invalid-token` are distinguished at the API
 * level — this screen shows the session-ended state for the former.
 */

import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Link } from "expo-router";
import { useAuthActions } from "@/src/contexts/AuthContext";

export default function LoginScreen() {
  const { signIn } = useAuthActions();
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.content}>
        <Text style={styles.title}>GlobalBridge</Text>
        <Text style={styles.subtitle}>Your immigration journey, simplified.</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#6B7280"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#6B7280"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? "Signing in..." : "Sign In"}
            </Text>
          </TouchableOpacity>
        </View>

        <Link href="/(auth)/register" asChild>
          <TouchableOpacity style={styles.linkButton}>
            <Text style={styles.linkText}>
              Don't have an account? <Text style={styles.linkBold}>Sign up</Text>
            </Text>
          </TouchableOpacity>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A1628",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#9CA3AF",
    textAlign: "center",
    marginBottom: 40,
  },
  form: {
    gap: 16,
  },
  input: {
    backgroundColor: "#1F2937",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#374151",
  },
  button: {
    backgroundColor: "#3B82F6",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  linkButton: {
    marginTop: 24,
    alignItems: "center",
  },
  linkText: {
    color: "#9CA3AF",
    fontSize: 14,
  },
  linkBold: {
    color: "#3B82F6",
    fontWeight: "600",
  },
});
