/**
 * Profile / Settings screen.
 *
 * Shows user info and provides sign-out. The sign-out action must also
 * unregister the FCM token (§8) — the client calls DELETE /users/device-tokens
 * before the Firebase session ends.
 */

import { useEffect, useState } from "react";
import { View, ScrollView, Pressable, Alert, Linking, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { get, del } from "@/src/api/client";
import { useAuth, useAuthActions } from "@/src/contexts/AuthContext";
import { updatePreferences, fetchDeviceTokens, type RegisteredDevice } from "@/src/api/endpoints";
import type { AuthUser } from "@/src/api/types";
import { useTheme, type ThemeMode } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, Button, Skeleton } from "@/src/components/ui";
import { AmbientBackground } from "@/src/components/AmbientBackground";
import { MIN_TOUCH } from "@/src/theme/tokens";
import { getPermissionStatus, enablePush, type PushPermission } from "@/src/services/push";

/** Same set offered during onboarding — one vocabulary for `preferred_language` everywhere it is set. */
const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "ar", label: "العربية" },
  { code: "pt", label: "Português" },
  { code: "sw", label: "Kiswahili" },
  { code: "hi", label: "हिन्दी" },
  { code: "zh", label: "中文" },
];

const APPEARANCE: Array<{ mode: ThemeMode; label: string }> = [
  { mode: "system", label: "Match device" },
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
];

export default function ProfileScreen() {
  useAuth();
  const { signOut } = useAuthActions();
  const { colors, space, radius, mode, setMode } = useTheme();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushPermission | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);

  useEffect(() => {
    get<{ user: AuthUser; profileComplete: boolean }>("/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => {});
    getPermissionStatus().then(setPushStatus).catch(() => {});
  }, []);

  /**
   * The only tap that may call `enablePush` — push.ts's own design note is
   * explicit that a permission prompt must come from a deliberate action, not
   * a mount effect. `denied` cannot be re-prompted (especially on iOS), so
   * that case hands off to the OS settings screen instead of asking again.
   * Already-granted opens the device list instead of re-prompting for
   * something already on — `GET /users/device-tokens` exists for exactly
   * this ("Powers the Settings screen", per its own comment on the server).
   */
  const handleNotifications = async () => {
    if (pushStatus === "denied") {
      Alert.alert(
        "Notifications are off",
        "Turn them back on from your phone's system settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ],
      );
      return;
    }
    if (pushStatus === "granted") {
      setDevicesOpen(true);
      return;
    }
    const result = await enablePush(user?.preferred_language ?? "en");
    setPushStatus(result);
  };

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

  const chooseLanguage = async (code: string) => {
    setLanguageOpen(false);
    const previous = user;
    setUser((u) => (u ? { ...u, preferred_language: code } : u));
    try {
      await updatePreferences({ preferred_language: code });
    } catch {
      setUser(previous);
      Alert.alert("Could not save", "Your language preference was not updated. Please try again.");
    }
  };

  const settingsRow = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    value: string | undefined,
    onPress: () => void,
  ) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: MIN_TOUCH,
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: space.md,
        marginBottom: space.sm,
      }}
    >
      <Ionicons name={icon} size={20} color={colors.ink6} />
      <GBText variant="body" style={{ flex: 1 }}>
        {label}
      </GBText>
      {value ? (
        <GBText variant="small" tone="subtle">
          {value}
        </GBText>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={colors.ink5} />
    </Pressable>
  );

  const currentLanguageLabel =
    LANGUAGES.find((l) => l.code === user?.preferred_language)?.label ?? "English";
  const currentAppearanceLabel = APPEARANCE.find((a) => a.mode === mode)?.label ?? "Match device";

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AmbientBackground />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.xl, paddingBottom: space.xxl }}
      >
        <GBText variant="title" style={{ marginBottom: space.lg }}>
          Profile
        </GBText>

      <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.xl }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: colors.clay,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <GBText variant="heading" style={{ color: "#ffffff" }}>
            {(user?.full_name ?? "U").charAt(0).toUpperCase()}
          </GBText>
        </View>
        <View style={{ flex: 1 }}>
          <GBText variant="heading">{user?.full_name ?? "Loading..."}</GBText>
          <GBText variant="small" tone="subtle" style={{ marginTop: 2 }}>
            {user?.email ?? ""}
          </GBText>
          {user?.role && (
            <View style={{ marginTop: space.sm, alignSelf: "flex-start" }}>
              <Badge label={user.role} tone="info" />
            </View>
          )}
        </View>
      </Card>

      {user?.verification_status && (
        <View style={{ marginBottom: space.xl }}>
          <GBText variant="tag" tone="subtle" style={{ marginBottom: space.sm }}>
            Verification
          </GBText>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              padding: space.md,
            }}
          >
            <Ionicons
              name={user.verification_status === "verified" ? "checkmark-circle" : "time"}
              size={20}
              color={user.verification_status === "verified" ? colors.leaf : colors.amber}
            />
            <GBText variant="body">
              {user.verification_status === "verified" ? "Identity verified" : "Verification pending"}
            </GBText>
          </View>
        </View>
      )}

      <View style={{ marginBottom: space.xl }}>
        <GBText variant="tag" tone="subtle" style={{ marginBottom: space.sm }}>
          Settings
        </GBText>
        {settingsRow("language", "Language", currentLanguageLabel, () => setLanguageOpen(true))}
        {settingsRow(
          "notifications",
          "Notifications",
          pushStatus === "granted" ? "On" : pushStatus === "denied" ? "Off" : undefined,
          () => void handleNotifications(),
        )}
        {settingsRow("moon", "Appearance", currentAppearanceLabel, () => setAppearanceOpen(true))}
      </View>

      <Button label="Sign Out" variant="danger" onPress={() => void handleSignOut()} />

      <GBText variant="small" tone="subtle" style={{ textAlign: "center", marginTop: space.xl }}>
        GlobalBridge v1.0.0
      </GBText>

      <PickerSheet
        visible={languageOpen}
        title="Language"
        options={LANGUAGES.map((l) => ({ key: l.code, label: l.label }))}
        selected={user?.preferred_language ?? "en"}
        onPick={(code) => void chooseLanguage(code)}
        onClose={() => setLanguageOpen(false)}
      />

      <PickerSheet
        visible={appearanceOpen}
        title="Appearance"
        options={APPEARANCE.map((a) => ({ key: a.mode, label: a.label }))}
        selected={mode}
        onPick={(key) => {
          setMode(key as ThemeMode);
          setAppearanceOpen(false);
        }}
        onClose={() => setAppearanceOpen(false)}
      />

      <DevicesSheet visible={devicesOpen} onClose={() => setDevicesOpen(false)} />
      </ScrollView>
    </View>
  );
}

/** A single-choice bottom sheet, shared by the Language and Appearance rows above. */
function PickerSheet({
  visible,
  title,
  options,
  selected,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Array<{ key: string; label: string }>;
  selected: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const { colors, space, radius } = useTheme();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.bg,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            maxHeight: "75%",
            padding: space.lg,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.md }}>
            <GBText variant="heading" style={{ flex: 1 }}>
              {title}
            </GBText>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.ink6} />
            </Pressable>
          </View>

          {options.map((option) => {
            const active = option.key === selected;
            return (
              <Pressable
                key={option.key}
                onPress={() => onPick(option.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: MIN_TOUCH,
                  paddingHorizontal: space.sm,
                  borderRadius: radius.md,
                  backgroundColor: active ? colors.claysoft : "transparent",
                  marginBottom: 2,
                }}
              >
                <GBText variant="body" style={{ flex: 1, color: active ? colors.clay6 : colors.ink }}>
                  {option.label}
                </GBText>
                {active ? <Ionicons name="checkmark" size={18} color={colors.clay} /> : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const PLATFORM_LABEL: Record<RegisteredDevice["platform"], string> = {
  ios: "iPhone",
  android: "Android device",
};

/** The read-only list `GET /users/device-tokens` exists to show. */
function DevicesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, space, radius } = useTheme();
  const [devices, setDevices] = useState<RegisteredDevice[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDevices(null);
    setFailed(false);
    fetchDeviceTokens()
      .then((res) => setDevices(res.devices))
      .catch(() => setFailed(true));
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.bg,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            maxHeight: "75%",
            padding: space.lg,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.md }}>
            <GBText variant="heading" style={{ flex: 1 }}>
              Notified devices
            </GBText>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.ink6} />
            </Pressable>
          </View>

          {failed ? (
            <GBText variant="small" tone="muted">
              Could not load your devices.
            </GBText>
          ) : devices === null ? (
            <View style={{ gap: space.sm }}>
              <Skeleton height={56} />
              <Skeleton height={56} />
            </View>
          ) : devices.length === 0 ? (
            <GBText variant="small" tone="muted">
              No devices are currently registered for notifications.
            </GBText>
          ) : (
            <View style={{ gap: space.sm, paddingBottom: space.md }}>
              {devices.map((d) => (
                <Card key={d.id}>
                  <GBText variant="label">{PLATFORM_LABEL[d.platform]}</GBText>
                  <GBText variant="small" tone="subtle" style={{ marginTop: 2 }}>
                    Last active {new Date(d.last_seen_at).toLocaleDateString()}
                    {d.app_version ? ` · v${d.app_version}` : ""}
                  </GBText>
                </Card>
              ))}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
