/**
 * Opportunities listing.
 *
 * Paginated list with infinite scroll. The pagination envelope (§6) uses
 * a real total for `hasMore`, so the client loops until `hasMore` is false.
 */

import { useCallback, useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { get } from "@/src/api/client";
import type { Opportunity, ListEnvelope } from "@/src/api/types";

const PAGE_SIZE = 20;

export default function OpportunitiesScreen() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const fetchPage = useCallback(async (pageOffset: number, isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else if (pageOffset > 0) return; // loading indicator is already showing

    try {
      const data = await get<ListEnvelope<Opportunity>>("/opportunities", {
        limit: PAGE_SIZE,
        offset: pageOffset,
        open_only: true,
      });

      if (isRefresh) {
        setItems(data.items);
      } else {
        setItems((prev) => [...prev, ...data.items]);
      }
      setHasMore(data.hasMore);
      setOffset(pageOffset + data.items.length);
    } catch {
      // Silent — the list just doesn't update
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(0, false);
  }, [fetchPage]);

  const loadMore = () => {
    if (hasMore && !loading) fetchPage(offset, false);
  };

  const renderItem = ({ item }: { item: Opportunity }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/(app)/opportunities/${item.id}`)}
    >
      <View style={styles.cardTop}>
        <View style={styles.typeBadge}>
          <Text style={styles.typeText}>{item.type}</Text>
        </View>
        {item.is_verified && (
          <Ionicons name="checkmark-circle" size={16} color="#10B981" />
        )}
      </View>
      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.meta}>
        {item.country}
        {item.funding_amount ? ` · ${item.funding_amount} ${item.currency ?? ""}` : ""}
      </Text>
      {item.deadline && (
        <Text style={styles.deadline}>
          Closes {new Date(item.deadline).toLocaleDateString()}
        </Text>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Opportunities</Text>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={() => { setOffset(0); fetchPage(0, true); }}
          ListFooterComponent={
            hasMore ? <ActivityIndicator style={{ margin: 16 }} color="#3B82F6" /> : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No opportunities found.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12 },
  headerTitle: { fontSize: 28, fontWeight: "700", color: "#FFFFFF" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 20 },
  card: {
    backgroundColor: "#1E293B", borderRadius: 12, padding: 16, marginBottom: 12,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  typeBadge: { backgroundColor: "#1E3A5F", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  typeText: { color: "#60A5FA", fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  title: { color: "#F1F5F9", fontSize: 16, fontWeight: "600", marginBottom: 4 },
  meta: { color: "#94A3B8", fontSize: 13 },
  deadline: { color: "#F59E0B", fontSize: 12, marginTop: 4 },
  emptyText: { color: "#6B7280", fontSize: 16 },
});
