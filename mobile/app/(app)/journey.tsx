import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, ProgressBar, Skeleton, ErrorState, EmptyState } from "@/src/components/ui";
import { fetchHome, type HomePayload } from "@/src/api/endpoints";

/**
 * Journey.
 *
 * Direction A from the design: stage cards with tappable tasks, rather than the
 * bridge spine. Stage cards win here because a task list is something you work
 * through, and the spine — which is the more distinctive drawing — puts the
 * emphasis on where you are rather than on what to do next.
 *
 * ── What is real and what is not ──────────────────────────────────────────
 * The progress figures come from `visa_checklists` via `GET /home`, which is
 * the same source the home screen reads, so the two can never disagree.
 *
 * The per-task list is **not** wired: the checklist items live in a JSONB
 * column whose per-item shape the API does not yet expose, and there is no
 * endpoint to tick one off. Rather than render fake tasks that do nothing when
 * tapped — §50 is explicit that there must be no dead controls — this screen
 * shows the real totals and says plainly that the detail is still coming.
 */

export default function JourneyScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [data, setData] = useState<HomePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setData(await fetchHome());
      setState("ready");
    } catch {
      setState("error");
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg, paddingTop: insets.top + space.md, gap: space.md }}>
        <Skeleton height={30} width="55%" />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </View>
    );
  }

  if (state === "error" || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: space.xl }}>
        <ErrorState onRetry={() => void load()} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.md,
        paddingBottom: space.xxl,
        gap: space.lg,
      }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.clay} />
      }
    >
      <GBText variant="title">Your visa roadmap</GBText>

      {data.checklist ? (
        <>
          <Card accent={colors.clay}>
            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Badge label="In progress" tone="brand" glyph="▸" />
                <GBText variant="label" tone="brand">
                  {data.checklist.percent}%
                </GBText>
              </View>
              <GBText variant="heading">
                {data.checklist.visa_type} · {data.checklist.destination_country}
              </GBText>
              <GBText variant="small" tone="muted">
                {data.checklist.completed} of {data.checklist.total} steps complete
              </GBText>
              <ProgressBar
                percent={data.checklist.percent}
                label={`Roadmap ${data.checklist.percent} percent complete`}
              />
            </View>
          </Card>

          <Card>
            <GBText variant="heading">Step detail is coming</GBText>
            <GBText variant="body" tone="muted" style={{ marginTop: 4 }}>
              Your totals above are live. Tapping individual steps needs an API
              that can record a step as done, which is not built yet — so rather
              than show a list that does nothing, it is not shown.
            </GBText>
          </Card>
        </>
      ) : (
        <EmptyState
          title="No roadmap yet"
          body="Once you tell the assistant where you are moving from and to, it will build your stages and tasks here."
          action={{ label: "Ask the assistant", onPress: () => router.push("/assistant") }}
        />
      )}

      {data.next_deadline ? (
        <View style={{ gap: space.sm }}>
          <GBText variant="heading">Next deadline</GBText>
          <Card accent={colors.amber}>
            <GBText variant="label">{data.next_deadline.title}</GBText>
            <GBText variant="small" tone="subtle" style={{ marginTop: 2 }}>
              {data.next_deadline.days_left} day
              {data.next_deadline.days_left === 1 ? "" : "s"} left
            </GBText>
          </Card>
        </View>
      ) : null}
    </ScrollView>
  );
}
