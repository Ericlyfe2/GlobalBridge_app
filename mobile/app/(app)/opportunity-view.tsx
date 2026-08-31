import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, Button, Skeleton, ErrorState } from "@/src/components/ui";
import { fetchOpportunity, type OpportunityDetail } from "@/src/api/endpoints";
import { MIN_TOUCH } from "@/src/theme/tokens";

/** One opportunity, in full. The list screen only ever shows a summary card. */
export default function OpportunityViewScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();

  const [data, setData] = useState<OpportunityDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    if (!params.id) return;
    setState("loading");
    try {
      const { opportunity } = await fetchOpportunity(params.id);
      setData(opportunity);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

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
          Opportunity
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
            title="Could not load this opportunity"
            body="It may have been removed, or the link has expired."
            onRetry={() => void load()}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Badge label={data.type} tone="info" />
            {data.is_verified ? <Badge label="Verified" tone="success" glyph="✓" /> : null}
            {data.sponsors_visa ? <Badge label="Sponsors visa" tone="brand" glyph="✓" /> : null}
          </View>

          <GBText variant="title">{data.title}</GBText>

          <Card>
            <View style={{ gap: space.sm }}>
              <Row icon="location-outline" label={data.country} />
              {data.institution ? <Row icon="school-outline" label={data.institution} /> : null}
              {data.field_of_study ? <Row icon="book-outline" label={data.field_of_study} /> : null}
              {data.funding_amount ? (
                <Row
                  icon="cash-outline"
                  label={`${data.currency ?? ""} ${Number(data.funding_amount).toLocaleString()}`.trim()}
                />
              ) : null}
              {data.deadline ? (
                <Row icon="calendar-outline" label={`Closes ${new Date(data.deadline).toLocaleDateString()}`} />
              ) : null}
            </View>
          </Card>

          {data.description ? (
            <Card>
              <GBText variant="body">{data.description}</GBText>
            </Card>
          ) : null}

          {data.application_url ? (
            <Button label="Apply" onPress={() => void Linking.openURL(data.application_url!)} />
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
