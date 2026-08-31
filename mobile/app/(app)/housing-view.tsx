import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, Button, Skeleton, ErrorState } from "@/src/components/ui";
import { fetchHousingListing, type HousingDetail } from "@/src/api/endpoints";
import { MIN_TOUCH } from "@/src/theme/tokens";

/** One housing listing, in full. explore.tsx only ever shows a summary card. */
export default function HousingViewScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();

  const [data, setData] = useState<HousingDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    if (!params.id) return;
    setState("loading");
    try {
      const { listing } = await fetchHousingListing(params.id);
      setData(listing);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const verified = data?.landlord_status === "verified";

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingHorizontal: space.lg,
          paddingBottom: space.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, justifyContent: "center" }}
        >
          <GBText variant="body" tone="brand">
            ‹ Back
          </GBText>
        </Pressable>
        <GBText variant="heading" style={{ flex: 1 }} numberOfLines={1}>
          Listing
        </GBText>
      </View>

      {state === "loading" ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton height={26} width="70%" />
          <Skeleton height={80} />
          <Skeleton height={120} />
        </View>
      ) : state === "error" || !data ? (
        <View style={{ flex: 1, justifyContent: "center", padding: space.xl }}>
          <ErrorState
            title="Could not load this listing"
            body="It may have been removed, or the link has expired."
            onRetry={() => void load()}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            {verified ? (
              <Badge label="Verified landlord" tone="success" glyph="✓" />
            ) : (
              <Badge label="Unverified landlord" tone="neutral" glyph="?" />
            )}
          </View>

          <GBText variant="title">{data.title}</GBText>

          <Card>
            <View style={{ gap: space.sm }}>
              <Row
                icon="location-outline"
                label={data.address ? `${data.address}, ${data.city}` : `${data.city}, ${data.country}`}
              />
              {data.near_university ? <Row icon="school-outline" label={`Near ${data.near_university}`} /> : null}
              <Row
                icon="bed-outline"
                label={
                  [
                    data.bedrooms != null ? `${data.bedrooms} bed` : null,
                    data.bathrooms != null ? `${data.bathrooms} bath` : null,
                    data.furnished ? "furnished" : "unfurnished",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                }
              />
              <Row
                icon="cash-outline"
                label={`${data.currency} ${Number(data.rent_amount).toLocaleString()} / ${data.rent_period ?? "month"}`}
              />
              <Row icon="person-outline" label={`Listed by ${data.landlord_name}`} />
            </View>
          </Card>

          {data.description ? (
            <Card>
              <GBText variant="body">{data.description}</GBText>
            </Card>
          ) : null}

          {data.virtual_tour_url ? (
            <Button label="Virtual tour" variant="secondary" onPress={() => void Linking.openURL(data.virtual_tour_url!)} />
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function Row({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const { space, colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Ionicons name={icon} size={18} color={colors.ink6} />
      <GBText variant="body" style={{ flex: 1 }}>
        {label}
      </GBText>
    </View>
  );
}
