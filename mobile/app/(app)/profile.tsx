/**
 * Profile / Settings screen.
 *
 * Shows user info and provides sign-out. The sign-out action must also
 * unregister the FCM token (§8) — the client calls DELETE /users/device-tokens
 * before the Firebase session ends.
 */

import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { get, del } from "@/src/api/client";
import { useAuth, useAuthActions } from "@/src/contexts/AuthContext";
import type { AuthUser } from "@/src/api/types";

export default function ProfileScreen() {
  const authState = useAuth();
  const { signOut } = useAuthActions();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    get<AuthUser>("/auth/me").then(setUser).catch(() => {});
  }, []);

  const handleSignOut = async () => {
    Alert.alert("Sign out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          try {
            // Unregister the FCM token before signing out (§8).
            // The token belongs to the app install; leaving it mapped
            // would deliver the next user's notifications to this phone.
            // We don't have the specific token here, so we clear all
            // device tokens for this user.
            await del("/users/device-tokens").catch(() => {});
          } finally {
            await signOut();
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      {/* User card */}
      <View style={styles.userCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.full_name ?? "U").charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user?.full_name ?? "Loading..."}</Text>
          <Text style={styles.userEmail}>{user?.email ?? ""}</Text>
          {user?.role && (
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{user.role}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Verification */}
      {user?.verification_status && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verification</Text>
          <View style={styles.row}>
            <Ionicons
              name={user.verification_status === "verified" ? "checkmark-circle" : "time"}
              size={20}
              color={user.verification_status === "verified" ? "#10B981" : "#F59E0B"}
            />
            <Text style={styles.rowText}>
              {user.verification_status === "verified"
                ? "Identity verified"
                : "Verification pending"}
            </Text>
          </View>
        </View>
      )}

      {/* Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Settings</Text>

        <TouchableOpacity style={styles.row}>
          <Ionicons name="language" size={20} color="#94A3B8" />
          <Text style={styles.rowText}>Language</Text>
          <Ionicons name="chevron-forward" size={16} color="#4B5563" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.row}>
          <Ionicons name="notifications" size={20} color="#94A3B8" />
          <Text style={styles.rowText}>Notifications</Text>
          <Ionicons name="chevron-forward" size={16} color="#4B5563" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.row}>
          <Ionicons name="moon" size={20} color="#94A3B8" />
          <Text style={styles.rowText}>Appearance</Text>
          <Ionicons name="chevron-forward" size={16} color="#4B5563" />
        </TouchableOpacity>
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Ionicons name="log-out" size={20} color="#EF4444" />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>GlobalBridge v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  content: { padding: 20, paddingTop: 60 },
  header: { marginBottom: 20 },
  headerTitle: { fontSize: 28, fontWeight: "700", color: "#FFFFFF" },

  userCard: {
    flexDirection: "row", alignItems: "center", gap: 16,
    backgroundColor: "#1E293B", borderRadius: 12, padding: 16, marginBottom: 24,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: "#3B82F6",
    justifyContent: "center", alignItems: "center",
  },
  avatarText: { color: "#FFFFFF", fontSize: 24, fontWeight: "700" },
  userInfo: { flex: 1 },
  userName: { color: "#F1F5F9", fontSize: 18, fontWeight: "600" },
  userEmail: { color: "#94A3B8", fontSize: 13, marginTop: 2 },
  roleBadge: {
    backgroundColor: "#1E3A5F", paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 6, marginTop: 6, alignSelf: "flex-start",
  },
  roleText: { color: "#60A5FA", fontSize: 11, fontWeight: "600" },

  section: { marginBottom: 24 },
  sectionTitle: {
    color: "#9CA3AF", fontSize: 13, fontWeight: "600",
    textTransform: "uppercase", marginBottom: 8,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#1E293B", borderRadius: 10, padding: 14, marginBottom: 6,
  },
  rowText: { color: "#CBD5E1", fontSize: 15, flex: 1 },

  signOutButton: {
    flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center",
    backgroundColor: "#1E293B", borderRadius: 12, padding: 14, marginTop: 8,
  },
  signOutText: { color: "#EF4444", fontSize: 16, fontWeight: "600" },

  version: { color: "#4B5563", fontSize: 12, textAlign: "center", marginTop: 24 },
});
