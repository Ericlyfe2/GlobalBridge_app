import React, { useState } from "react";
import { View, ScrollView, TextInput, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, Button } from "@/src/components/ui";
import { checkDocument, type DocCheckResult } from "@/src/api/endpoints";
import { radius as radiusTokens, MIN_TOUCH } from "@/src/theme/tokens";

/**
 * Document Checker — quick check, no photo.
 *
 * The primary flow is the camera capture at /scan, which uploads a real file
 * and checks it against the same endpoint this screen calls. This is the
 * secondary path: pick a document type and add what you already know, when you
 * would rather not photograph anything yet — checking a document you have not
 * scanned in, or double-checking before you go find the physical copy.
 *
 * ── What this tool can and cannot know ─────────────────────────────────────
 * It never sees a file, here or in the camera flow — it reasons about what
 * governments commonly reject for a document of this type. Every finding is
 * phrased as something to verify, never as an observation about a document it
 * was not given.
 */

const DOC_TYPES = [
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID" },
  { value: "bank_statement", label: "Bank statement" },
  { value: "transcript", label: "Transcript" },
  { value: "acceptance_letter", label: "Admission letter" },
  { value: "study_permit", label: "Study permit" },
  { value: "insurance", label: "Insurance" },
  { value: "other", label: "Something else" },
];

const SEVERITY_TONE = { ok: "success", warn: "warning", fail: "danger" } as const;
const SEVERITY_MARK = { ok: "✓", warn: "!", fail: "×" };

export default function DocCheckScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [docType, setDocType] = useState("passport");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<DocCheckResult | null>(null);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    setLoading(true);
    try {
      const res = await checkDocument({ docType, notes: notes.trim() || undefined });
      setResult(res);
    } catch {
      setResult(null);
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
        <View style={{ gap: 4 }}>
          <GBText variant="title">Quick document check</GBText>
          <GBText variant="small" tone="subtle">
            No photo needed — pick the type and add what you already know.
          </GBText>
        </View>

        <View style={{ gap: space.sm }}>
          <GBText variant="label">Document type</GBText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {DOC_TYPES.map((t) => {
              const active = t.value === docType;
              return (
                <Pressable
                  key={t.value}
                  onPress={() => setDocType(t.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={{
                    minHeight: MIN_TOUCH,
                    justifyContent: "center",
                    paddingHorizontal: space.md,
                    borderRadius: radiusTokens.pill,
                    backgroundColor: active ? colors.claysoft : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? colors.clay : colors.border,
                  }}
                >
                  <GBText variant="small" style={{ color: active ? colors.clay6 : colors.ink6 }}>
                    {t.label}
                  </GBText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional — name on the document, expiry date, anything you have handy"
          placeholderTextColor={colors.ink5}
          multiline
          numberOfLines={3}
          maxLength={30000}
          accessibilityLabel="Notes"
          style={{
            minHeight: 90,
            borderRadius: radiusTokens.md,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            padding: space.md,
            color: colors.ink,
            fontSize: 15,
            textAlignVertical: "top",
          }}
        />

        <Button label="Check document" onPress={() => void check()} loading={loading} />

        <Pressable
          onPress={() => router.push("/scan")}
          accessibilityRole="button"
          style={{ minHeight: MIN_TOUCH, justifyContent: "center" }}
        >
          <GBText variant="small" tone="brand">
            Have the document in hand? Photograph it instead →
          </GBText>
        </Pressable>

        {result ? (
          <Card>
            <View style={{ gap: space.sm }}>
              {result.disabled ? (
                <Badge label="Turned off by an admin" tone="neutral" glyph="—" />
              ) : result.degraded ? (
                <Badge label="Standard checklist — not personalised" tone="warning" glyph="!" />
              ) : null}

              <GBText variant="heading">{result.label}</GBText>
              <GBText variant="small" tone="muted">
                {result.summary}
              </GBText>

              {result.findings.map((f) => (
                <View
                  key={f.id}
                  style={{
                    flexDirection: "row",
                    gap: space.sm,
                    paddingTop: space.sm,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <GBText
                    variant="tag"
                    style={{
                      color:
                        SEVERITY_TONE[f.severity] === "danger"
                          ? colors.danger
                          : SEVERITY_TONE[f.severity] === "warning"
                            ? colors.amber
                            : colors.clay6,
                      width: 20,
                    }}
                  >
                    {SEVERITY_MARK[f.severity]}
                  </GBText>
                  <View style={{ flex: 1, gap: 2 }}>
                    <GBText variant="small">{f.label}</GBText>
                    <GBText variant="small" tone="subtle">
                      {f.detail}
                    </GBText>
                  </View>
                </View>
              ))}
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
