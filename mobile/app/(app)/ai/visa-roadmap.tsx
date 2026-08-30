import React, { useState } from "react";
import { View, ScrollView, TextInput, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, Button } from "@/src/components/ui";
import { generateRoadmap, type RoadmapResult } from "@/src/api/endpoints";
import { MIN_TOUCH } from "@/src/theme/tokens";

/**
 * Visa Roadmap.
 *
 * The fallback roadmap the server returns when the model is unreachable is
 * generic and marked `degraded`; the costs and timeframes in *any* roadmap —
 * real or fallback — are estimates, marked `estimates_only`, and never
 * presented as an official fee. Both banners are shown when the server sets
 * them, never inferred locally.
 */

const PURPOSES = [
  { key: "study", label: "Study" },
  { key: "work", label: "Work" },
  { key: "settle", label: "Settle" },
] as const;

export default function VisaRoadmapScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]["key"]>("study");
  const [result, setResult] = useState<RoadmapResult | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!origin.trim() || !destination.trim()) return;
    setLoading(true);
    try {
      const res = await generateRoadmap({
        origin: origin.trim(),
        destination: destination.trim(),
        purpose,
      });
      setResult(res);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.md,
        paddingBottom: space.xxl,
        gap: space.md,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <GBText variant="title">Visa Roadmap</GBText>

      <TextInput
        value={origin}
        onChangeText={setOrigin}
        placeholder="Where you are now"
        placeholderTextColor={colors.ink5}
        autoCapitalize="words"
        accessibilityLabel="Origin country"
        style={{
          minHeight: MIN_TOUCH,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: space.md,
          color: colors.ink,
          fontSize: 15,
        }}
      />
      <TextInput
        value={destination}
        onChangeText={setDestination}
        placeholder="Where you are going"
        placeholderTextColor={colors.ink5}
        autoCapitalize="words"
        accessibilityLabel="Destination country"
        style={{
          minHeight: MIN_TOUCH,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: space.md,
          color: colors.ink,
          fontSize: 15,
        }}
      />

      <View style={{ flexDirection: "row", gap: space.sm }}>
        {PURPOSES.map((p) => {
          const active = p.key === purpose;
          return (
            <Pressable
              key={p.key}
              onPress={() => setPurpose(p.key)}
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
                {p.label}
              </GBText>
            </Pressable>
          );
        })}
      </View>

      <Button
        label="Generate roadmap"
        onPress={() => void generate()}
        disabled={!origin.trim() || !destination.trim()}
        loading={loading}
      />

      {result ? (
        <Card>
          <View style={{ gap: space.sm }}>
            {result.degraded ? (
              <Badge label="Generic roadmap — AI unavailable" tone="warning" glyph="!" />
            ) : null}

            <GBText variant="heading">{result.title}</GBText>
            <GBText variant="small" tone="subtle">
              ≈ {result.totalWeeks} weeks
            </GBText>

            {result.phases.map((phase, i) => (
              <View
                key={phase.id}
                style={{
                  gap: 4,
                  paddingTop: space.sm,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      backgroundColor: colors.clay,
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 1,
                    }}
                  >
                    <GBText variant="tag" tone="inverse">
                      {i + 1}
                    </GBText>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <GBText variant="label">{phase.title}</GBText>
                    <GBText variant="small" tone="subtle">
                      {phase.timeframe} · {phase.cost}
                    </GBText>
                  </View>
                </View>
                {phase.documents.length > 0 ? (
                  <GBText variant="small" tone="subtle" style={{ marginLeft: 34 }}>
                    Documents: {phase.documents.join(", ")}
                  </GBText>
                ) : null}
                <GBText variant="small" tone="brand" style={{ marginLeft: 34, fontStyle: "italic" }}>
                  {phase.tip}
                </GBText>
              </View>
            ))}

            {result.estimates_only ? (
              <GBText variant="small" tone="subtle" style={{ textAlign: "center", marginTop: space.xs }}>
                Costs and timeframes are estimates. Verify on the official
                government site.
              </GBText>
            ) : null}
          </View>
        </Card>
      ) : null}
    </ScrollView>
  );
}
