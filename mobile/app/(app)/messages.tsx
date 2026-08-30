/**
 * Messages — conversation list.
 *
 * GET /messages returns conversations with the other user's name and the
 * last message preview. Unread counts drive the badge on the home screen.
 */

import { useCallback, useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { get } from "@/src/api/client";
import type { Conversation, ListEnvelope } from "@/src/api/types";

const PAGE_SIZE = 20;

export default function MessagesScreen() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const fetchPage = useCallback(async (pageOffset: number) => {
    try {
      const data = await get<ListEnvelope<Conversation>>("/messages", {
        limit: PAGE_SIZE,
        offset: pageOffset,
      });
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
    <TouchableOpacity style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {item.other_user_name.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>{item.other_user_name}</Text>
          {item.last_message_at && (
            <Text style={styles.time}>
              {formatRelativeTime(item.last_message_at)}
            </Text>
          )}
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.preview} numberOfLines={1}>
            {item.last_message ?? "No messages yet"}
          </Text>
          {item.unread_count > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{item.unread_count}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      ) : (
        <FlatList
          data={conversations}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          onEndReached={() => hasMore && fetchPage(offset)}
          onEndReachedThreshold={0.5}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="chatbubbles-outline" size={48} color="#374151" />
              <Text style={styles.emptyText}>No conversations yet</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12 },
  headerTitle: { fontSize: 28, fontWeight: "700", color: "#FFFFFF" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  list: { padding: 20 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#1E293B", borderRadius: 12, padding: 14, marginBottom: 8,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "#3B82F6",
    justifyContent: "center", alignItems: "center",
  },
  avatarText: { color: "#FFFFFF", fontSize: 18, fontWeight: "600" },
  rowContent: { flex: 1 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  name: { color: "#F1F5F9", fontSize: 15, fontWeight: "600", flex: 1 },
  time: { color: "#64748B", fontSize: 12 },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  preview: { color: "#94A3B8", fontSize: 13, flex: 1 },
  unreadBadge: {
    backgroundColor: "#3B82F6", borderRadius: 10, minWidth: 20, height: 20,
    justifyContent: "center", alignItems: "center", paddingHorizontal: 6,
  },
  unreadText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  emptyText: { color: "#6B7280", fontSize: 16 },
});
