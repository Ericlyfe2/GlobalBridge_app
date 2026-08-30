import React, { useCallback, useEffect, useState } from "react";
import { View, FlatList, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, EmptyState, ErrorState, Skeleton } from "@/src/components/ui";
import {
  fetchOpportunities,
  fetchHousing,
  type Opportunity,
  type HousingListing,
} from "@/src/api/endpoints";
import { MIN_TOUCH } from "@/src/theme/tokens";

/**
 * Explore.
 *
 * Two tabs against real endpoints. The design shows four — Jobs and Mentors as
 * well — and those are declared here as explicitly unavailable rather than
 * quietly omitted: §49 and §50 both say a control must either work or say why
 * it does not. A tab that silently is not there teaches the user the app is
 * smaller than it is; a tab that says "not yet" is honest and costs nothing.
 *
 * ── Paging ────────────────────────────────────────────────────────────────
 * `hasMore` comes from the server's envelope, computed there from a real
 * count. Inferring it from `items.length === limit` is the bug the envelope was
 * introduced to kill: it stops one page early whenever the last page happens to
 * be exactly full.
 */

type Tab = "opportunities" | "housing" | "jobs" | "mentors";

const TABS: Array<{ key: Tab; label: string; available: boolean }> = [
  { key: "opportunities", label: "Funding", available: true },
  { key: "housing", label: "Housing", available: true },
  { key: "jobs", label: "Jobs", available: false },
  { key: "mentors", label: "Mentors", available: false },
];

const PAGE = 20;

type Row = { kind: "opportunity"; item: Opportunity } | { kind: "housing"; item: HousingListing };

export default function ExploreScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>("opportunities");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (nextOffset: number, search: string, which: Tab) => {
      if (which !== "opportunities" && which !== "housing") return;

      nextOffset === 0 ? setLoading(true) : setPaging(true);
      setFailed(false);

      try {
        if (which === "opportunities") {
          const page = await fetchOpportunities({
            limit: PAGE,
            offset: nextOffset,
            q: search || undefined,
          });
          const mapped: Row[] = page.items.map((item) => ({ kind: "opportunity", item }));
          setRows((prev) => (nextOffset === 0 ? mapped : [...prev, ...mapped]));
          setHasMore(page.hasMore);
          setOffset(nextOffset + page.items.length);
        } else {
          const page = await fetchHousing({
            limit: PAGE,
            offset: nextOffset,
            q: search || undefined,
          });
          const mapped: Row[] = page.items.map((item) => ({ kind: "housing", item }));
          setRows((prev) => (nextOffset === 0 ? mapped : [...prev, ...mapped]));
          setHasMore(page.hasMore);
          setOffset(nextOffset + page.items.length);
        }
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
        setPaging(false);
      }
    },
    [],
  );

  // Debounced so a search box does not fire a request per keystroke — §33, and
  // a real cost on a metered connection.
  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0);
      void load(0, query, tab);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, tab, load]);

  const activeTab = TABS.find((t) => t.key === tab)!;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.md }}>
        <GBText variant="title">Explore</GBText>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={tab === "housing" ? "Search city or listing" : "Search funding and programmes"}
          placeholderTextColor={colors.ink5}
          accessibilityLabel="Search"
          style={{
            minHeight: MIN_TOUCH,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: space.md,
            color: colors.ink,
            fontSize: 15,
          }}
        />

        <View style={{ flexDirection: "row", gap: space.sm }}>
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <Pressable
                key={t.key}
                onPress={() => t.available && setTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active, disabled: !t.available }}
                style={{
                  paddingHorizontal: space.md,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  backgroundColor: active ? colors.claysoft : "transparent",
                  opacity: t.available ? 1 : 0.45,
                }}
              >
                <GBText variant="label" style={{ color: active ? colors.clay6 : colors.ink6 }}>
                  {t.label}
                </GBText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {!activeTab.available ? (
        <EmptyState
          title={`${activeTab.label} is not in this build yet`}
          body="The backend for this section is ready; the screen is still being built. Funding and Housing both work now."
        />
      ) : loading ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </View>
      ) : failed && rows.length === 0 ? (
        <ErrorState onRetry={() => void load(0, query, tab)} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing matched"
          body={
            query
              ? `No results for “${query}”. Try a shorter search.`
              : "There is nothing here yet. Check back soon."
          }
          action={query ? { label: "Clear search", onPress: () => setQuery("") } : undefined}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => `${row.kind}:${row.item.id}`}
          contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl }}
          // Virtualised: §41 forbids rendering hundreds of cards at once, and a
          // mid-range Android is the device that proves it.
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasMore && !paging) void load(offset, query, tab);
          }}
          ListFooterComponent={
            paging ? (
              <ActivityIndicator style={{ marginVertical: space.lg }} color={colors.clay} />
            ) : !hasMore && rows.length > 0 ? (
              <GBText variant="small" tone="subtle" style={{ textAlign: "center", marginVertical: space.lg }}>
                That is everything
              </GBText>
            ) : null
          }
          renderItem={({ item: row }) =>
            row.kind === "opportunity" ? (
              <OpportunityCard item={row.item} />
            ) : (
              <HousingCard item={row.item} />
            )
          }
        />
      )}
    </View>
  );
}

function OpportunityCard({ item }: { item: Opportunity }) {
  const { space } = useTheme();
  return (
    <Card style={{ paddingVertical: space.md }}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
          <GBText variant="label" style={{ flex: 1 }} numberOfLines={2}>
            {item.title}
          </GBText>
          {item.is_verified ? <Badge label="Verified" tone="success" glyph="✓" /> : null}
        </View>
        <GBText variant="small" tone="subtle">
          {item.country}
          {item.deadline ? ` · closes ${formatDate(item.deadline)}` : " · no deadline"}
        </GBText>
        {item.funding_amount ? (
          <GBText variant="small" tone="brand">
            {item.currency ?? ""} {Number(item.funding_amount).toLocaleString()}
          </GBText>
        ) : null}
      </View>
    </Card>
  );
}

function HousingCard({ item }: { item: HousingListing }) {
  const { space } = useTheme();
  const verified = item.landlord_status === "verified";
  return (
    <Card style={{ paddingVertical: space.md }}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
          <GBText variant="label" style={{ flex: 1 }} numberOfLines={2}>
            {item.title}
          </GBText>
          {/*
            Only where the backend actually verified. An unverified landlord
            does not get to borrow the shape of a verified one — that is the
            whole point of the badge on a platform people get defrauded on.
          */}
          {verified ? (
            <Badge label="Verified" tone="success" glyph="✓" />
          ) : (
            <Badge label="Unverified" tone="neutral" glyph="?" />
          )}
        </View>
        <GBText variant="small" tone="subtle">
          {item.city}, {item.country}
          {item.bedrooms != null ? ` · ${item.bedrooms} bed` : ""}
          {item.furnished ? " · furnished" : ""}
        </GBText>
        <GBText variant="label" tone="brand">
          {item.currency} {Number(item.rent_amount).toLocaleString()}
          <GBText variant="small" tone="subtle">
            {" "}
            / {item.rent_period ?? "month"}
          </GBText>
        </GBText>
      </View>
    </Card>
  );
}

function formatDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}
