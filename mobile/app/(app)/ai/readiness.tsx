import React, { useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Button, ProgressBar } from "@/src/components/ui";
import {
  scoreReadiness,
  type ReadinessPillarKey,
  type ReadinessResult,
} from "@/src/api/endpoints";
import { MIN_TOUCH } from "@/src/theme/tokens";

/**
 * Readiness Score.
 *
 * The overall figure is arithmetic over the user's own self-report, computed
 * server-side — never something the model estimates. Only the coaching text
 * per pillar and the three suggested actions come from the model, and both
 * degrade gracefully to the lowest-pillar-first fallback when it is
 * unreachable (backend: lib/ai/fallbacks.ts).
 */

const PILLARS: Array<{ key: ReadinessPillarKey; label: string }> = [
  { key: "documents", label: "Documents" },
  { key: "finances", label: "Finances" },
  { key: "housing", label: "Housing" },
  { key: "job", label: "Job / income" },
  { key: "community", label: "Community" },
];

const PRESETS = [0, 25, 50, 75, 100];

export default function ReadinessScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const [scores, setScores] = useState<Record<ReadinessPillarKey, number>>({
    documents: 50,
    finances: 50,
    housing: 50,
    job: 50,
    community: 50,
  });
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Four brand tones cycled across five pillars, keeping every colour a
  // semantic token — never a hex introduced just for this screen.
  const pillarTone = (i: number) => [colors.sky, colors.leaf, colors.amber, colors.clay][i % 4];

  const analyze = async () => {
    setLoading(true);
    try {
      const res = await scoreReadiness({ pillars: scores });
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
    >
      <View style={{ gap: 4 }}>
        <GBText variant="title">Readiness Score</GBText>
        <GBText variant="small" tone="subtle">
          Rate how far along you feel on each. There is no wrong answer.
        </GBText>
      </View>

      {PILLARS.map((p, i) => {
        const tone = pillarTone(i);
        return (
          <Card key={p.key}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: space.sm }}>
              <GBText variant="label">{p.label}</GBText>
              <GBText variant="small" tone="subtle">
                {scores[p.key]}/100
              </GBText>
            </View>
            <ProgressBar percent={scores[p.key]} color={tone} label={`${p.label} readiness`} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space.sm }}>
              {PRESETS.map((v) => {
                const active = scores[p.key] === v;
                return (
                  <Pressable
                    key={v}
                    onPress={() => setScores((prev) => ({ ...prev, [p.key]: v }))}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={{
                      minWidth: 40,
                      minHeight: 32,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.sm,
                      backgroundColor: active ? tone + "26" : "transparent",
                    }}
                  >
                    <GBText variant="small" style={{ color: active ? tone : colors.ink5 }}>
                      {v}
                    </GBText>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        );
      })}

      <Button label="Get my score" onPress={() => void analyze()} loading={loading} />

      {result ? (
        <Card>
          <View style={{ gap: space.sm }}>
            <GBText variant="small" tone="subtle">
              Overall readiness
            </GBText>
            <GBText variant="display">{result.overall}/100</GBText>

            <View style={{ gap: 6, marginTop: space.xs }}>
              {result.pillars.map((p) => (
                <View key={p.key} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <GBText variant="small" style={{ width: 92 }}>
                    {p.label}
                  </GBText>
                  <GBText variant="small" tone="subtle" style={{ width: 28, textAlign: "right" }}>
                    {p.score}
                  </GBText>
                  <GBText variant="small" tone="subtle" style={{ flex: 1 }}>
                    {p.note}
                  </GBText>
                </View>
              ))}
            </View>

            {result.actions.length > 0 ? (
              <View
                style={{
                  gap: space.sm,
                  marginTop: space.sm,
                  paddingTop: space.sm,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                <GBText variant="heading">Next steps</GBText>
                {result.actions.map((a, i) => (
                  <View key={i} style={{ gap: 2 }}>
                    <GBText variant="label">{a.title}</GBText>
                    <GBText variant="small" tone="subtle">
                      {a.detail}
                    </GBText>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

      <View style={{ minHeight: MIN_TOUCH }} accessibilityElementsHidden />
    </ScrollView>
  );
}
