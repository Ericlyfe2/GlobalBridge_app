import React, { useState } from "react";
import { View, ScrollView, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Button, Badge } from "@/src/components/ui";
import { compareCountries, type CompareResult } from "@/src/api/endpoints";
import { ApiError } from "@/src/api/client";

/**
 * Country Compare.
 *
 * The server refuses two identical codes and any code it does not recognise
 * rather than inventing a comparison for one — see routes/ai/compare-countries.ts
 * on the backend. Both refusals arrive as a plain-language `error` string,
 * which is what this screen shows verbatim rather than a generic failure.
 */

export default function CompareCountriesScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const [code1, setCode1] = useState("");
  const [code2, setCode2] = useState("");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const compare = async () => {
    if (!code1.trim() || !code2.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await compareCountries({
        country1: code1.trim().toLowerCase(),
        country2: code2.trim().toLowerCase(),
      });
      setResult(res);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : undefined;
      setError(message || "Could not compare these countries.");
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
      <View style={{ gap: 4 }}>
        <GBText variant="title">Country Compare</GBText>
        <GBText variant="small" tone="subtle">
          Two destinations, side by side, with sources where we have them.
        </GBText>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <TextInput
          value={code1}
          onChangeText={(t) => setCode1(t.slice(0, 2))}
          placeholder="e.g. gh"
          placeholderTextColor={colors.ink5}
          autoCapitalize="characters"
          maxLength={2}
          accessibilityLabel="First country, ISO two-letter code"
          style={{
            flex: 1,
            minHeight: 52,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.ink,
            fontSize: 18,
            fontWeight: "600",
            textAlign: "center",
          }}
        />
        <GBText variant="label" tone="subtle">
          vs
        </GBText>
        <TextInput
          value={code2}
          onChangeText={(t) => setCode2(t.slice(0, 2))}
          placeholder="e.g. ca"
          placeholderTextColor={colors.ink5}
          autoCapitalize="characters"
          maxLength={2}
          accessibilityLabel="Second country, ISO two-letter code"
          style={{
            flex: 1,
            minHeight: 52,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.ink,
            fontSize: 18,
            fontWeight: "600",
            textAlign: "center",
          }}
        />
      </View>
      <GBText variant="small" tone="subtle">
        ISO two-letter country codes — gh for Ghana, ca for Canada, and so on.
      </GBText>

      <Button
        label="Compare"
        onPress={() => void compare()}
        disabled={!code1.trim() || !code2.trim()}
        loading={loading}
      />

      {error ? (
        <Card accent={colors.danger}>
          <GBText variant="small" tone="danger">
            {error}
          </GBText>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <GBText variant="heading">{result.country1Name}</GBText>
              <GBText variant="heading">{result.country2Name}</GBText>
            </View>

            {result.categories.map((cat, i) => (
              <View
                key={i}
                style={{
                  paddingTop: space.sm,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                  gap: 4,
                }}
              >
                <GBText variant="tag" tone="subtle">
                  {cat.label}
                </GBText>
                <View style={{ flexDirection: "row", gap: space.md }}>
                  <GBText variant="small" style={{ flex: 1 }}>
                    {cat.country1}
                  </GBText>
                  <GBText variant="small" style={{ flex: 1 }}>
                    {cat.country2}
                  </GBText>
                </View>
              </View>
            ))}

            {result.summary ? (
              <GBText variant="body" tone="muted" style={{ marginTop: space.xs }}>
                {result.summary}
              </GBText>
            ) : null}
            {result.verdict ? (
              <GBText variant="small" tone="brand" style={{ fontStyle: "italic" }}>
                {result.verdict}
              </GBText>
            ) : null}

            {result.estimates_only ? (
              <Badge label="Figures are estimates" tone="neutral" glyph="~" />
            ) : null}
          </View>
        </Card>
      ) : null}
    </ScrollView>
  );
}
