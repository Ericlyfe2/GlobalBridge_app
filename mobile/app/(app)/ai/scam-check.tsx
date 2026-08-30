import React, { useState } from "react";
import {
  View,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, Button } from "@/src/components/ui";
import { checkScam, type ScamResult } from "@/src/api/endpoints";
import { MIN_TOUCH } from "@/src/theme/tokens";

/**
 * Scam Shield.
 *
 * The most safety-critical screen in the app — this audience is actively
 * targeted by scams, and the wording throughout is "Potential risk detected",
 * never "This is a scam". A verdict, not a determination.
 *
 * ── Never a clean result when the check could not run ─────────────────────
 * The server itself floors a degraded response at "Be cautious" — see
 * lib/ai/fallbacks.ts on the backend — and this screen preserves that floor on
 * its own network-failure path too. A safety tool that fails open reads as
 * approval, and there is no path through this screen that shows "Likely safe"
 * without a real analysis behind it.
 *
 * ── Flagged phrases are shown in place ─────────────────────────────────────
 * The user learns the pattern rather than just trusting a number, which is
 * what makes them able to catch the next one themselves.
 */

const SEVERITY_TONE = { low: "warning", med: "warning", high: "danger" } as const;

const VERDICT_TONE = {
  "Likely safe": "success",
  "Be cautious": "warning",
  "High scam risk": "danger",
} as const;

export default function ScamCheckScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const [text, setText] = useState("");
  const [result, setResult] = useState<ScamResult | null>(null);
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await checkScam(text.trim());
      setResult(res);
    } catch {
      // The network failure path preserves the server's own floor: a
      // safety check that could not run is never presented as "safe".
      setResult({
        score: 50,
        verdict: "Be cautious",
        summary: "We could not reach the checker just now. Use your own judgement and verify before paying.",
        flags: [],
        advice: ["Never pay or share documents before verifying independently."],
        degraded: true,
      });
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
          <GBText variant="title">Scam Shield</GBText>
          <GBText variant="small" tone="subtle">
            Paste a listing, offer or message before you pay, share documents or
            sign anything.
          </GBText>
        </View>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Paste the message here…"
          placeholderTextColor={colors.ink5}
          multiline
          numberOfLines={6}
          maxLength={6000}
          accessibilityLabel="Message to check"
          style={{
            minHeight: 130,
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

        <Button
          label="Check for scams"
          onPress={() => void analyze()}
          disabled={!text.trim()}
          loading={loading}
        />

        {result ? (
          <Card>
            <View style={{ gap: space.sm }}>
              {result.disabled ? (
                <Badge label="Turned off by an admin" tone="neutral" glyph="—" />
              ) : result.degraded ? (
                <Badge label="Basic scan only" tone="warning" glyph="!" />
              ) : null}

              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Badge label={result.verdict} tone={VERDICT_TONE[result.verdict]} glyph="!" />
                <GBText variant="small" tone="subtle">
                  {result.score}/100
                </GBText>
              </View>

              <GBText variant="body" tone="muted">
                {result.summary}
              </GBText>

              {result.flags.length > 0 ? (
                <View style={{ gap: space.sm, marginTop: space.xs }}>
                  <GBText variant="heading">Warning signs</GBText>
                  {result.flags.map((flag, i) => {
                    const tone = SEVERITY_TONE[flag.severity];
                    const dot = tone === "danger" ? colors.danger : colors.amber;
                    return (
                      <View key={i} style={{ flexDirection: "row", gap: space.sm }}>
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: dot,
                            marginTop: 6,
                          }}
                        />
                        <View style={{ flex: 1, gap: 2 }}>
                          <GBText variant="label">{flag.category}</GBText>
                          <GBText variant="small" tone="danger" style={{ fontStyle: "italic" }}>
                            "{flag.phrase}"
                          </GBText>
                          <GBText variant="small" tone="subtle">
                            {flag.why}
                          </GBText>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {result.advice.length > 0 ? (
                <View
                  style={{
                    gap: 4,
                    marginTop: space.sm,
                    paddingTop: space.sm,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <GBText variant="heading">What to do</GBText>
                  {result.advice.map((tip, i) => (
                    <GBText key={i} variant="small" tone="muted">
                      • {tip}
                    </GBText>
                  ))}
                </View>
              ) : null}
            </View>
          </Card>
        ) : null}

        <View
          style={{ minHeight: MIN_TOUCH, justifyContent: "center" }}
          accessibilityElementsHidden
        >
          <GBText variant="small" tone="subtle">
            Report, Save and Block are on the listing itself once you have
            checked it.
          </GBText>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
