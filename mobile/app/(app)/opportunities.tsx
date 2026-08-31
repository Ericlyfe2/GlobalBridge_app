/**
 * Opportunities listing.
 *
 * Paginated list with infinite scroll. The pagination envelope (§6) uses
 * a real total for `hasMore`, so the client loops until `hasMore` is false.
 */

import { useCallback, useEffect, useState } from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { get } from "@/src/api/client";
import type { Opportunity, ListEnvelope } from "@/src/api/types";
import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, EmptyState } from "@/src/components/ui";

const PAGE_SIZE = 20;

export default function OpportunitiesScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();

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
    <Card
      onPress={() => router.push({ pathname: "/opportunity-view", params: { id: item.id } } as never)}
      style={{ marginBottom: space.md }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <Badge label={item.type} tone="info" />
        {item.is_verified && <Ionicons name="checkmark-circle" size={16} color={colors.leaf} />}
      </View>
      <GBText variant="label" numberOfLines={2} style={{ marginBottom: 4 }}>
        {item.title}
      </GBText>
      <GBText variant="small" tone="subtle">
        {item.country}
        {item.funding_amount ? ` · ${item.funding_amount} ${item.currency ?? ""}` : ""}
      </GBText>
      {item.deadline && (
        <GBText variant="small" tone="warning" style={{ marginTop: 4 }}>
          Closes {new Date(item.deadline).toLocaleDateString()}
        </GBText>
      )}
    </Card>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <GBText variant="title">Opportunities</GBText>
      </View>
      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={colors.clay} />
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ padding: space.lg }}
          refreshing={refreshing}
          onRefresh={() => { setOffset(0); fetchPage(0, true); }}
          ListFooterComponent={
            hasMore ? <ActivityIndicator style={{ margin: 16 }} color={colors.clay} /> : null
          }
          ListEmptyComponent={
            <View style={{ paddingTop: space.xxl }}>
              <EmptyState title="No opportunities found" body="Check back soon — new listings are added regularly." />
            </View>
          }
        />
      )}
    </View>
  );
}
