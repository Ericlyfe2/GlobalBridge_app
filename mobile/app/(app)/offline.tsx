import React from "react";
import { View, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Button, Badge } from "@/src/components/ui";
import { useConnectivity } from "@/src/hooks/useConnectivity";

/**
 * Offline.
 *
 * A designed screen, not a generic network error — §18 and §40 both ask for
 * this, and the difference matters: "Network request failed" tells the user
 * something broke and implies it might be their fault. This tells them what
 * still works.
 *
 * ── What is listed is what genuinely works ────────────────────────────────
 * Checklist progress, saved documents metadata and message history are cached
 * locally, so they are honestly available. The AI tools and anything requiring
 * a signed URL are not, and are listed as unavailable rather than left for the
 * user to discover by tapping.
 */
export default function OfflineScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { online, checking, recheck } = useConnectivity();

  const works = [
    "Your visa roadmap and how far through it you are",
    "Documents you have already added, and their status",
    "Messages you have already opened",
    "Anything you saved",
  ];

  const doesNot = [
    "The AI assistant and every AI tool",
    "Opening a document — those links are issued fresh each time",
    "New listings, funding and mentors",
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxl,
        gap: space.md,
      }}
    >
      <View style={{ gap: space.sm }}>
        <Badge
          label={online ? "Back online" : checking ? "Checking" : "No connection"}
          tone={online ? "success" : "warning"}
          glyph={online ? "✓" : "!"}
        />
        <GBText variant="display">
          {online ? "You are back" : "You are offline"}
        </GBText>
        <GBText variant="body" tone="muted">
          {online
            ? "Everything is available again."
            : "GlobalBridge keeps working with what it already has. Nothing you have done is lost."}
        </GBText>
      </View>

      {online ? (
        <Button label="Continue" onPress={() => router.replace("/")} />
      ) : (
        <>
          <Card>
            <GBText variant="heading">Still available</GBText>
            <View style={{ gap: 6, marginTop: space.sm }}>
              {works.map((line) => (
                <View key={line} style={{ flexDirection: "row", gap: space.sm }}>
                  <GBText variant="small" tone="brand">
                    ✓
                  </GBText>
                  <GBText variant="small" tone="muted" style={{ flex: 1 }}>
                    {line}
                  </GBText>
                </View>
              ))}
            </View>
          </Card>

          <Card>
            <GBText variant="heading">Needs a connection</GBText>
            <View style={{ gap: 6, marginTop: space.sm }}>
              {doesNot.map((line) => (
                <View key={line} style={{ flexDirection: "row", gap: space.sm }}>
                  <GBText variant="small" tone="subtle">
                    —
                  </GBText>
                  <GBText variant="small" tone="subtle" style={{ flex: 1 }}>
                    {line}
                  </GBText>
                </View>
              ))}
            </View>
          </Card>

          <Button label={checking ? "Checking…" : "Try again"} onPress={recheck} loading={checking} />

          <GBText variant="small" tone="subtle" style={{ textAlign: "center" }}>
            We check for you automatically, so you do not have to keep tapping.
          </GBText>
        </>
      )}
    </ScrollView>
  );
}
