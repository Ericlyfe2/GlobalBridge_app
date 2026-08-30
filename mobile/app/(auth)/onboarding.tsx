import React, { useState } from "react";
import { View, ScrollView, Pressable, TextInput, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Button, ProgressBar } from "@/src/components/ui";
import { registerProfile, updatePreferences } from "@/src/api/endpoints";
import { useAuthActions } from "@/src/contexts/AuthContext";
import { MIN_TOUCH } from "@/src/theme/tokens";

/**
 * Onboarding.
 *
 * Three short steps, cards rather than fields, and every question after the
 * first is skippable — §5, and the design's own note. It is deliberately not a
 * government form: the people filling this in have just finished several that
 * were, and the difference in tone is most of the reason they would trust this
 * one.
 *
 * ── It only asks what it can keep ─────────────────────────────────────────
 * The brief lists a dozen possible fields — education level, intended intake,
 * visa type, budget, career interests. The API has columns for name, role,
 * origin, destination and language, and nothing else. Collecting the rest would
 * mean either dropping the answers on the floor or inventing storage for them,
 * and asking someone for their intake year and then forgetting it is worse than
 * never asking.
 *
 * When those columns exist, the steps go here.
 */

const ROLES = [
  { key: "student", label: "I am moving to study", note: "Visas, funding, housing, mentors" },
  { key: "mentor", label: "I have already moved", note: "Help others make the same move" },
  { key: "employer", label: "I am hiring", note: "Post roles with visa sponsorship" },
] as const;

const COMMON_DESTINATIONS = [
  "Canada",
  "United Kingdom",
  "Germany",
  "United States",
  "Australia",
  "Ireland",
  "Netherlands",
  "France",
];

/** The locales the server can localise notifications into. */
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

const STEPS = 3;

export default function OnboardingScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { refreshProfile } = useAuthActions();

  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]["key"]>("student");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [language, setLanguage] = useState("en");
  const [saving, setSaving] = useState(false);

  const finish = async () => {
    if (!fullName.trim()) {
      Alert.alert("Your name is needed", "It is the one thing we cannot skip — mentors and messages use it.");
      setStep(0);
      return;
    }

    setSaving(true);
    try {
      await registerProfile({
        full_name: fullName.trim(),
        role,
        country_of_origin: origin.trim() || undefined,
        country_of_residence: destination.trim() || undefined,
        preferred_language: language,
        // The device's own zone. Reminders resolve against this, so a wrong one
        // means a session alert at the wrong hour.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      // Language is sent again through preferences so a later change goes
      // through exactly one code path rather than two.
      await updatePreferences({ preferred_language: language }).catch(() => undefined);

      await refreshProfile();
      router.replace("/(app)");
    } catch (err) {
      const message = (err as { message?: string }).message;
      Alert.alert(
        "We could not finish setting up",
        message ?? "Nothing was lost. Please try again in a moment.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxl,
        gap: space.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: space.sm }}>
        <ProgressBar percent={((step + 1) / STEPS) * 100} label={`Step ${step + 1} of ${STEPS}`} />
        <GBText variant="small" tone="subtle">
          Step {step + 1} of {STEPS}
        </GBText>
      </View>

      {step === 0 ? (
        <View style={{ gap: space.md }}>
          <GBText variant="display">What should we call you?</GBText>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your full name"
            placeholderTextColor={colors.ink5}
            autoCapitalize="words"
            accessibilityLabel="Full name"
            style={{
              minHeight: MIN_TOUCH,
              borderRadius: radius.md,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: space.md,
              color: colors.ink,
              fontSize: 16,
            }}
          />
          <GBText variant="small" tone="subtle">
            Use the name on your passport if you can — it keeps your documents
            consistent, which is one of the most common reasons applications get
            returned.
          </GBText>

          <GBText variant="heading" style={{ marginTop: space.sm }}>
            Which of these is you?
          </GBText>
          {ROLES.map((option) => {
            const active = option.key === role;
            return (
              <Card
                key={option.key}
                onPress={() => setRole(option.key)}
                accessibilityLabel={option.label}
                style={{
                  borderColor: active ? colors.clay : colors.border,
                  backgroundColor: active ? colors.claysoft : colors.surface,
                }}
              >
                <GBText variant="label">{option.label}</GBText>
                <GBText variant="small" tone="subtle" style={{ marginTop: 2 }}>
                  {option.note}
                </GBText>
              </Card>
            );
          })}
        </View>
      ) : null}

      {step === 1 ? (
        <View style={{ gap: space.md }}>
          <GBText variant="display">Where are you moving?</GBText>
          <GBText variant="body" tone="muted">
            This shapes your roadmap and what we show you. You can skip it and
            set it later.
          </GBText>

          <GBText variant="label">Where you are now</GBText>
          <TextInput
            value={origin}
            onChangeText={setOrigin}
            placeholder="Country"
            placeholderTextColor={colors.ink5}
            autoCapitalize="words"
            accessibilityLabel="Country you are moving from"
            style={{
              minHeight: MIN_TOUCH,
              borderRadius: radius.md,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: space.md,
              color: colors.ink,
              fontSize: 16,
            }}
          />

          <GBText variant="label" style={{ marginTop: space.sm }}>
            Where you are going
          </GBText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {COMMON_DESTINATIONS.map((country) => {
              const active = destination === country;
              return (
                <Pressable
                  key={country}
                  onPress={() => setDestination(active ? "" : country)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={{
                    paddingHorizontal: space.md,
                    paddingVertical: 10,
                    borderRadius: radius.pill,
                    backgroundColor: active ? colors.claysoft : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? colors.clay : colors.border,
                  }}
                >
                  <GBText variant="small" style={{ color: active ? colors.clay6 : colors.ink6 }}>
                    {country}
                  </GBText>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={COMMON_DESTINATIONS.includes(destination) ? "" : destination}
            onChangeText={setDestination}
            placeholder="Somewhere else"
            placeholderTextColor={colors.ink5}
            autoCapitalize="words"
            accessibilityLabel="Another destination"
            style={{
              minHeight: MIN_TOUCH,
              borderRadius: radius.md,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: space.md,
              color: colors.ink,
              fontSize: 16,
            }}
          />
        </View>
      ) : null}

      {step === 2 ? (
        <View style={{ gap: space.md }}>
          <GBText variant="display">Which language suits you?</GBText>
          <GBText variant="body" tone="muted">
            Deadline and safety alerts are written in this language before they
            reach your phone.
          </GBText>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {LANGUAGES.map((option) => {
              const active = option.code === language;
              return (
                <Pressable
                  key={option.code}
                  onPress={() => setLanguage(option.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={{
                    paddingHorizontal: space.md,
                    paddingVertical: 10,
                    borderRadius: radius.pill,
                    backgroundColor: active ? colors.claysoft : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? colors.clay : colors.border,
                  }}
                >
                  <GBText variant="small" style={{ color: active ? colors.clay6 : colors.ink6 }}>
                    {option.label}
                  </GBText>
                </Pressable>
              );
            })}
          </View>

          <Card style={{ marginTop: space.sm }}>
            <GBText variant="label">Nothing has been submitted anywhere</GBText>
            <GBText variant="small" tone="subtle" style={{ marginTop: 4 }}>
              This sets up your account inside GlobalBridge only. No application
              has been filed and no government has been contacted.
            </GBText>
          </Card>
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Button
          label={step === STEPS - 1 ? "Finish" : "Continue"}
          loading={saving}
          onPress={() => {
            if (step === STEPS - 1) void finish();
            else setStep((s) => s + 1);
          }}
        />
        {step > 0 ? (
          <Button label="Back" variant="ghost" onPress={() => setStep((s) => s - 1)} />
        ) : null}
        {step > 0 && step < STEPS - 1 ? (
          <Button label="Skip this" variant="ghost" onPress={() => setStep((s) => s + 1)} />
        ) : null}
      </View>
    </ScrollView>
  );
}
