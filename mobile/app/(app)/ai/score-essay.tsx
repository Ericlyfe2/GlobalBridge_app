import React, { useState } from "react";
import { View, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Button, Badge } from "@/src/components/ui";
import { scoreEssay, type EssayResult } from "@/src/api/endpoints";
import { ApiError } from "@/src/api/client";
import { MIN_TOUCH } from "@/src/theme/tokens";

/**
 * Essay / SoP review.
 *
 * The one AI feature with no canned fallback (backend: routes/ai/score-essay.ts).
 * A fabricated review would quote passages the user did not write and score
 * work the model never read, for a document about to go to a university, so
 * the server answers 503 rather than degrade, and this screen's only job on
 * that path is to say plainly that the draft itself was not touched.
 */

const DOC_TYPES = [
  { value: "sop", label: "Statement of Purpose" },
  { value: "personal_statement", label: "Personal Statement" },
  { value: "scholarship_essay", label: "Scholarship Essay" },
  { value: "motivation_letter", label: "Motivation Letter" },
  { value: "cover_letter", label: "Cover Letter" },
] as const;

function scoreTone(score: number): "success" | "warning" | "danger" {
  if (score >= 70) return "success";
  if (score >= 50) return "warning";
  return "danger";
}

export default function ScoreEssayScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const [essay, setEssay] = useState("");
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]["value"]>("sop");
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<EssayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    if (!essay.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await scoreEssay({ essay: essay.trim(), docType, target: target.trim() || undefined });
      setResult(res);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(
        apiErr?.status === 503
          ? "Essay review is temporarily unavailable. Your draft has not been changed."
          : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.md,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <GBText variant="title">Essay / SoP review</GBText>

        <View style={{ gap: space.sm }}>
          <GBText variant="label">Document type</GBText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {DOC_TYPES.map((dt) => {
              const active = dt.value === docType;
              return (
                <Pressable
                  key={dt.value}
                  onPress={() => setDocType(dt.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={{
                    minHeight: MIN_TOUCH,
                    justifyContent: "center",
                    paddingHorizontal: space.md,
                    borderRadius: radius.pill,
                    backgroundColor: active ? colors.claysoft : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? colors.clay : colors.border,
                  }}
                >
                  <GBText variant="small" style={{ color: active ? colors.clay6 : colors.ink6 }}>
                    {dt.label}
                  </GBText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <TextInput
          value={target}
          onChangeText={setTarget}
          placeholder="Target school or programme (optional)"
          placeholderTextColor={colors.ink5}
          accessibilityLabel="Target institution"
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
          value={essay}
          onChangeText={setEssay}
          placeholder="Paste your draft here..."
          placeholderTextColor={colors.ink5}
          multiline
          maxLength={20000}
          accessibilityLabel="Essay draft"
          style={{
            minHeight: 180,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            padding: space.md,
            color: colors.ink,
            fontSize: 15,
            textAlignVertical: "top",
          }}
        />

        <Button label="Review essay" onPress={() => void analyze()} disabled={!essay.trim()} loading={loading} />

        {error ? (
          <Card accent={colors.amber}>
            <GBText variant="small" tone="muted">
              {error}
            </GBText>
          </Card>
        ) : null}

        {result ? (
          <Card>
            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <GBText variant="heading">Overall</GBText>
                <Badge label={`${result.overall}/100`} tone={scoreTone(result.overall)} />
              </View>

              {result.sections.map((s) => (
                <View
                  key={s.id}
                  style={{
                    paddingTop: space.sm,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    gap: 2,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <GBText variant="label">{s.label}</GBText>
                    <GBText variant="small" tone="subtle">
                      {s.score}/100
                    </GBText>
                  </View>
                  <GBText variant="small" tone="subtle">
                    {s.comment}
                  </GBText>
                </View>
              ))}

              {result.inlines.length > 0 ? (
                <View
                  style={{
                    gap: space.sm,
                    marginTop: space.xs,
                    paddingTop: space.sm,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <GBText variant="heading">In your draft</GBText>
                  {result.inlines.map((inline, i) => (
                    <View key={i} style={{ gap: 2 }}>
                      <GBText variant="small" tone="danger" style={{ fontStyle: "italic" }}>
                        "{inline.quote}"
                      </GBText>
                      <GBText variant="small" tone="subtle">
                        {inline.comment}
                      </GBText>
                    </View>
                  ))}
                </View>
              ) : null}

              {result.tips.length > 0 ? (
                <View style={{ marginTop: space.xs, gap: 4 }}>
                  <GBText variant="heading">Top improvements</GBText>
                  {result.tips.map((tip, i) => (
                    <GBText key={i} variant="small" tone="muted">
                      {i + 1}. {tip}
                    </GBText>
                  ))}
                </View>
              ) : null}
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
