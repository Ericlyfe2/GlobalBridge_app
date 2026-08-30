/**
 * Registration screen.
 *
 * Creates the Firebase account, then calls /auth/register-profile to
 * create the Postgres profile. If profile creation fails, the client
 * must delete the Firebase user (§7).
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
  ScrollView,
} from "react-native";
import { Link, router } from "expo-router";
import { useAuthActions } from "@/src/contexts/AuthContext";

export default function RegisterScreen() {
  const { signUp } = useAuthActions();
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Start your immigration journey.</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Full name"
            placeholderTextColor="#6B7280"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            autoComplete="name"
          />
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
            placeholder="Password (min 8 characters)"
            placeholderTextColor="#6B7280"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
          />

          <Text style={styles.label}>I am a...</Text>
          <View style={styles.roleRow}>
            {(["student", "mentor", "employer"] as const).map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.roleButton, role === r && styles.roleButtonActive]}
                onPress={() => setRole(r)}
              >
                <Text style={[styles.roleText, role === r && styles.roleTextActive]}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? "Creating account..." : "Create Account"}
            </Text>
          </TouchableOpacity>
        </View>

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity style={styles.linkButton}>
            <Text style={styles.linkText}>
              Already have an account? <Text style={styles.linkBold}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 40 },
  title: { fontSize: 32, fontWeight: "700", color: "#FFFFFF", textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#9CA3AF", textAlign: "center", marginBottom: 32 },
  form: { gap: 14 },
  input: {
    backgroundColor: "#1F2937", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: "#FFFFFF", borderWidth: 1, borderColor: "#374151",
  },
  label: { color: "#9CA3AF", fontSize: 14, marginTop: 8 },
  roleRow: { flexDirection: "row", gap: 10 },
  roleButton: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center",
    backgroundColor: "#1F2937", borderWidth: 1, borderColor: "#374151",
  },
  roleButtonActive: { backgroundColor: "#1E40AF", borderColor: "#3B82F6" },
  roleText: { color: "#9CA3AF", fontSize: 14, fontWeight: "500" },
  roleTextActive: { color: "#FFFFFF" },
  button: { backgroundColor: "#3B82F6", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  linkButton: { marginTop: 24, alignItems: "center" },
  linkText: { color: "#9CA3AF", fontSize: 14 },
  linkBold: { color: "#3B82F6", fontWeight: "600" },
});
