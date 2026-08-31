/**
 * Messages — conversation list.
 *
 * GET /messages returns conversations with the other user's name and the
 * last message preview. Unread counts drive the badge on the home screen.
 */

import { useCallback, useEffect, useState } from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { fetchConversations, type Conversation } from "@/src/api/endpoints";
import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, EmptyState } from "@/src/components/ui";

const PAGE_SIZE = 20;

export default function MessagesScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const fetchPage = useCallback(async (pageOffset: number) => {
    try {
      const data = await fetchConversations({ limit: PAGE_SIZE, offset: pageOffset });
      if (pageOffset === 0) {
        setConversations(data.items);
      } else {
        setConversations((prev) => [...prev, ...data.items]);
      }
      setHasMore(data.hasMore);
      setOffset(pageOffset + data.items.length);
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(0);
  }, [fetchPage]);

  const renderItem = ({ item }: { item: Conversation }) => (
    <Card
      onPress={() =>
        router.push({
          pathname: "/thread",
          params: { id: item.id, name: item.other_user_name },
        } as never)
      }
      style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.sm }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.clay,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <GBText variant="label" style={{ color: "#ffffff" }}>
          {item.other_user_name.charAt(0).toUpperCase()}
        </GBText>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
          <GBText variant="label" numberOfLines={1} style={{ flex: 1 }}>
            {item.other_user_name}
          </GBText>
          {item.last_message_at && (
            <GBText variant="small" tone="subtle">
              {formatRelativeTime(item.last_message_at)}
            </GBText>
          )}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <GBText variant="small" tone="subtle" numberOfLines={1} style={{ flex: 1 }}>
            {item.last_message ?? "No messages yet"}
          </GBText>
          {Number(item.unread_count) > 0 && (
            <View
              style={{
                backgroundColor: colors.clay,
                borderRadius: radius.pill,
                minWidth: 20,
                height: 20,
                justifyContent: "center",
                alignItems: "center",
                paddingHorizontal: 6,
              }}
            >
              <GBText variant="tag" style={{ color: "#ffffff" }}>
                {item.unread_count}
              </GBText>
            </View>
          )}
        </View>
      </View>
    </Card>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <GBText variant="title">Messages</GBText>
      </View>
      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={colors.clay} />
        </View>
      ) : (
        <FlatList
          data={conversations}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          onEndReached={() => hasMore && fetchPage(offset)}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ padding: space.lg }}
          ListEmptyComponent={
            <View style={{ paddingTop: space.xxl }}>
              <EmptyState
                title="No conversations yet"
                body="Messages from mentors and employers will show up here."
              />
            </View>
          }
        />
      )}
    </View>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
