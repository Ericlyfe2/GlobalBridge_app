import React, { useState } from "react";
import { View, ScrollView, TextInput, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, Button } from "@/src/components/ui";
import { translateTexts } from "@/src/api/endpoints";
import { MIN_TOUCH } from "@/src/theme/tokens";

/**
 * Translate.
 *
 * Batch UI-string translation, the same endpoint the app itself would use to
 * localise its own screens once i18n is wired. When it cannot run, the server
 * returns the source strings rather than an error — a screen with English text
 * on it beats one with nothing on it — and that degraded state is shown here
 * rather than presented as a real translation.
 */

const LANGUAGES = [
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "de", label: "German" },
  { code: "ar", label: "Arabic" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "hi", label: "Hindi" },
  { code: "sw", label: "Swahili" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "tr", label: "Turkish" },
];

export default function TranslateScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const [input, setInput] = useState("");
  const [target, setTarget] = useState("fr");
  const [result, setResult] = useState<string[] | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(false);

  const translate = async () => {
    const texts = input.split("\n").filter((l) => l.trim());
    if (texts.length === 0) return;
    setLoading(true);
    try {
      const res = await translateTexts({ texts, target });
      setResult(res.translations);
      setDegraded(Boolean(res.degraded));
    } catch {
      setResult(texts);
      setDegraded(true);
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
      <GBText variant="title">Translate</GBText>

      <View style={{ gap: space.sm }}>
        <GBText variant="label">Target language</GBText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {LANGUAGES.map((lang) => {
            const active = lang.code === target;
            return (
              <Pressable
                key={lang.code}
                onPress={() => setTarget(lang.code)}
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
                  {lang.label}
                </GBText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder={"One line of text per string to translate..."}
        placeholderTextColor={colors.ink5}
        multiline
        accessibilityLabel="Text to translate"
        style={{
          minHeight: 140,
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

      <Button label="Translate" onPress={() => void translate()} disabled={!input.trim()} loading={loading} />

      {result ? (
        <Card>
          <View style={{ gap: space.sm }}>
            {degraded ? (
              <Badge label="Source text returned — translation unavailable" tone="warning" glyph="!" />
            ) : null}
            {result.map((line, i) => (
              <View key={i} style={{ flexDirection: "row", gap: space.sm }}>
                <GBText variant="small" tone="subtle" style={{ width: 22 }}>
                  {i + 1}
                </GBText>
                <GBText variant="small" style={{ flex: 1 }}>
                  {line}
                </GBText>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
    </ScrollView>
  );
}
