import React, { useCallback, useEffect, useState } from "react";
import { View, FlatList, RefreshControl, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Skeleton, EmptyState, ErrorState } from "@/src/components/ui";
import {
  fetchNotifications,
  markNotificationsRead,
  type Notification,
} from "@/src/api/endpoints";
import { MIN_TOUCH } from "@/src/theme/tokens";

/**
 * Notification centre.
 *
 * ── Priority is carried by more than colour ───────────────────────────────
 * Security and deadline notifications get a left border, a mono tag, and sort
 * above everything else. The tag is what makes the priority survive greyscale
 * and colour blindness — §27's rule, and the design's own note about the
 * SEC / DUE / DOC vocabulary.
 *
 * ── Marking read is optimistic ────────────────────────────────────────────
 * The row updates immediately and reverts if the server refuses. Waiting for a
 * round trip to un-bold a row is the kind of latency that makes an app feel
 * broken on a slow connection, and the cost of being briefly wrong is nil.
 */

const KIND: Record<string, { tag: string; tone: "danger" | "warning" | "info" | "brand" | "neutral" }> = {
  security: { tag: "SEC", tone: "danger" },
  deadline: { tag: "DUE", tone: "warning" },
  document: { tag: "DOC", tone: "info" },
  message: { tag: "MSG", tone: "brand" },
  mentor: { tag: "MEN", tone: "brand" },
  opportunity: { tag: "OPP", tone: "info" },
  housing: { tag: "HSE", tone: "warning" },
  job: { tag: "JOB", tone: "info" },
  info: { tag: "INFO", tone: "neutral" },
};

/** Never collapsed, never sorted below anything. */
const URGENT = new Set(["security", "deadline"]);

export default function NotificationsScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [items, setItems] = useState<Notification[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const page = await fetchNotifications({ limit: 50 });
      const sorted = [...page.items].sort((a, b) => {
        const au = URGENT.has(a.kind) && !a.read ? 1 : 0;
        const bu = URGENT.has(b.kind) && !b.read ? 1 : 0;
        if (au !== bu) return bu - au;
        return b.created_at.localeCompare(a.created_at);
      });
      setItems(sorted);
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

  const open = useCallback(
    async (item: Notification) => {
      if (!item.read) {
        const previous = items;
        setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
        markNotificationsRead([item.id]).catch(() => setItems(previous));
      }
      if (item.deep_link) router.push(item.deep_link as never);
    },
    [items, router],
  );

  const markAll = useCallback(async () => {
    const previous = items;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    markNotificationsRead().catch(() => setItems(previous));
  }, [items]);

  const unread = items.filter((n) => !n.read).length;

  if (state === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg, paddingTop: insets.top + space.md, gap: space.sm }}>
        <Skeleton height={30} width="55%" />
        <Skeleton height={72} />
        <Skeleton height={72} />
        <Skeleton height={72} />
      </View>
    );
  }

  if (state === "error") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: space.xl }}>
        <ErrorState onRetry={() => void load()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: space.lg,
          paddingBottom: space.sm,
          gap: space.sm,
        }}
      >
        <GBText variant="title" style={{ flex: 1 }}>
          Notifications
        </GBText>
        {unread > 0 ? (
          <Pressable
            onPress={() => void markAll()}
            accessibilityRole="button"
            accessibilityLabel="Mark all as read"
            style={{ minHeight: MIN_TOUCH, justifyContent: "center" }}
          >
            <GBText variant="label" tone="brand">
              Mark all read
            </GBText>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.clay} />
        }
        ListEmptyComponent={
          <EmptyState
            title="Nothing here yet"
            body="Deadlines, safety alerts and replies will appear here. Turn on notifications in Profile to get them on your lock screen too."
          />
        }
        renderItem={({ item }) => {
          const meta = KIND[item.kind] ?? KIND.info;
          const accent =
            meta.tone === "danger"
              ? colors.danger
              : meta.tone === "warning"
                ? colors.amber
                : meta.tone === "info"
                  ? colors.sky
                  : meta.tone === "brand"
                    ? colors.clay
                    : colors.border2;

          return (
            <Card
              accent={accent}
              onPress={() => void open(item)}
              accessibilityLabel={`${meta.tag}: ${item.title}${item.read ? "" : ", unread"}`}
              style={{ paddingVertical: space.md, opacity: item.read ? 0.72 : 1 }}
            >
              <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
                <GBText variant="tag" style={{ color: accent, width: 38 }}>
                  {meta.tag}
                </GBText>
                <View style={{ flex: 1, gap: 2 }}>
                  <GBText variant="label">{item.title}</GBText>
                  {item.body ? (
                    <GBText variant="small" tone="subtle">
                      {item.body}
                    </GBText>
                  ) : null}
                  <GBText variant="small" tone="subtle">
                    {formatWhen(item.created_at)}
                  </GBText>
                </View>
                {/* Unread is a dot as well as weight, never weight alone. */}
                {!item.read ? (
                  <View
                    style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent, marginTop: 6 }}
                  />
                ) : null}
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
}

function formatWhen(iso: string): string {
  const then = new Date(iso);
  const hours = (Date.now() - then.getTime()) / 36e5;
  if (hours < 1) return "Just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(then);
}
