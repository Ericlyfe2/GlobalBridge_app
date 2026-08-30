import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView, RefreshControl, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, ProgressBar, Skeleton, ErrorState, StaleBanner } from "@/src/components/ui";
import { fetchHome, type HomePayload } from "@/src/api/endpoints";
import { useConnectivity } from "@/src/hooks/useConnectivity";
import { cacheGet, cacheSet } from "@/src/services/storage";

/**
 * Home.
 *
 * The design offers three directions for this screen — next action, timeline,
 * five facets. This implements direction A, the design's own default: a single
 * next action above everything else.
 *
 * That choice is the product thesis in one layout. The brief opens by saying
 * the app exists to reduce overwhelm, and §6 says the screen must answer "what
 * should I do next?" before it answers anything else. A timeline or a facet
 * grid shows more and answers less.
 *
 * One request fills all of it. Eight separate calls before the first screen
 * renders is eight round trips on the worst connection the user will have that
 * day, in front of a splash screen.
 */

const CACHE_KEY = "home";

type Loadable =
  | { state: "loading" }
  | { state: "ready"; data: HomePayload; cachedAt?: number }
  | { state: "error" };

export default function HomeScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { online } = useConnectivity();

  const [view, setView] = useState<Loadable>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await fetchHome();
      setView({ state: "ready", data });
      // Cached so a cold start with no signal still shows something real rather
      // than a spinner. The banner above it says how old it is.
      await cacheSet(CACHE_KEY, data);
    } catch {
      const cached = await cacheGet<HomePayload>(CACHE_KEY);
      if (cached) {
        setView({ state: "ready", data: cached.value, cachedAt: cached.at });
      } else {
        setView({ state: "error" });
      }
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (view.state === "loading") return <HomeSkeleton />;

  if (view.state === "error") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: space.xl }}>
        <ErrorState
          title="We could not load your home screen"
          body="You are offline and there is nothing saved yet. Once you are back online this will fill in."
          onRetry={() => void load()}
        />
      </View>
    );
  }

  const { data, cachedAt } = view;

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
      {cachedAt ? <StaleBanner at={cachedAt} online={online} /> : null}

      <Greeting name={data.user.full_name} unread={data.unread} />

      <NextAction data={data} onOpen={(href) => router.push(href as never)} />

      {data.checklist ? (
        <Card onPress={() => router.push("/journey")} accessibilityLabel="Open your visa roadmap">
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <GBText variant="heading">Your roadmap</GBText>
            <GBText variant="label" tone="brand">
              {data.checklist.percent}%
            </GBText>
          </View>
          <GBText variant="small" tone="muted" style={{ marginTop: 2, marginBottom: space.md }}>
            {data.checklist.completed} of {data.checklist.total} steps ·{" "}
            {data.checklist.visa_type} to {data.checklist.destination_country}
          </GBText>
          <ProgressBar
            percent={data.checklist.percent}
            label={`Roadmap ${data.checklist.percent} percent complete`}
          />
        </Card>
      ) : null}

      {data.alerts.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <GBText variant="heading">Needs your attention</GBText>
          {data.alerts.map((alert) => (
            <AlertRow
              key={alert.id}
              kind={alert.kind}
              title={alert.title}
              body={alert.body}
              onPress={() => {
                if (alert.deep_link) router.push(alert.deep_link as never);
              }}
            />
          ))}
        </View>
      ) : null}

      {data.opportunities.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <GBText variant="heading">Closing soon</GBText>
            <Pressable onPress={() => router.push("/explore")} accessibilityRole="button">
              <GBText variant="label" tone="brand">
                See all
              </GBText>
            </Pressable>
          </View>
          {data.opportunities.map((opportunity) => (
            <Card
              key={opportunity.id}
              onPress={() => router.push(`/opportunities?id=${opportunity.id}` as never)}
              style={{ paddingVertical: space.md }}
            >
              <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <GBText variant="label" numberOfLines={2}>
                    {opportunity.title}
                  </GBText>
                  <GBText variant="small" tone="subtle">
                    {opportunity.country}
                    {opportunity.deadline ? ` · closes ${formatDate(opportunity.deadline)}` : ""}
                  </GBText>
                </View>
                {/*
                  Verified is a badge with a glyph, never a colour or a shape an
                  unverified listing could borrow. §12: an unverified listing
                  must not resemble a verified one.
                */}
                {opportunity.is_verified ? <Badge label="Verified" tone="success" glyph="✓" /> : null}
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      <View
        style={{
          borderRadius: radius.md,
          backgroundColor: colors.alt,
          padding: space.md,
        }}
      >
        <GBText variant="small" tone="subtle">
          GlobalBridge guides and cites its sources. It is not a government
          service and does not give legal advice.
        </GBText>
      </View>
    </ScrollView>
  );
}

/**
 * The greeting.
 *
 * Time of day is computed on the device, not sent by the server — the payload
 * deliberately carries no timestamp so its ETag stays stable between launches.
 */
function Greeting({ name, unread }: { name: string; unread: { messages: number; notifications: number } }) {
  const { space } = useTheme();
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = name.trim().split(/\s+/)[0];
  const total = unread.messages + unread.notifications;

  return (
    <View style={{ gap: 4 }}>
      <GBText variant="display">
        {part}, {firstName}
      </GBText>
      {total > 0 ? (
        <GBText variant="body" tone="muted">
          {unread.messages > 0
            ? `${unread.messages} new message${unread.messages === 1 ? "" : "s"}`
            : `${unread.notifications} new notification${unread.notifications === 1 ? "" : "s"}`}
        </GBText>
      ) : (
        <GBText variant="body" tone="muted" style={{ marginBottom: space.xs }}>
          Here is where things stand.
        </GBText>
      )}
    </View>
  );
}

/**
 * The single next action.
 *
 * Chosen server-side data, prioritised here: a safety alert outranks a
 * deadline, a deadline outranks a session, and an unfinished profile outranks
 * nothing at all. The order is the product's judgement about what costs the
 * user most if missed.
 */
function NextAction({ data, onOpen }: { data: HomePayload; onOpen: (href: string) => void }) {
  const { colors, space } = useTheme();

  const security = data.alerts.find((a) => a.kind === "security");

  const action = security
    ? { tag: "SEC", tone: colors.danger, soft: colors.dangersoft, title: security.title, body: security.body ?? "", href: security.deep_link ?? "/notifications" }
    : data.next_deadline
      ? {
          tag: "DUE",
          tone: colors.amber,
          soft: colors.ambersoft,
          title: data.next_deadline.title,
          body: `${data.next_deadline.days_left} day${data.next_deadline.days_left === 1 ? "" : "s"} left · closes ${formatDate(data.next_deadline.deadline)}`,
          href: data.next_deadline.href,
        }
      : data.next_session
        ? {
            tag: "SESSION",
            tone: colors.clay,
            soft: colors.claysoft,
            title: `Session with ${data.next_session.with_name}`,
            // Rendered in the viewer's own zone. The server sends an instant
            // precisely so this can be correct after the user travels.
            body: formatWhen(data.next_session.starts_at),
            href: data.next_session.href,
          }
        : !data.user.profile_complete
          ? {
              tag: "SETUP",
              tone: colors.sky,
              soft: colors.skysoft,
              title: "Finish setting up your profile",
              body: "It takes a minute and makes everything else more useful.",
              href: "/profile",
            }
          : null;

  if (!action) {
    return (
      <Card>
        <GBText variant="heading">Nothing needs you right now</GBText>
        <GBText variant="body" tone="muted" style={{ marginTop: 4 }}>
          No deadlines, no alerts. A good moment to look at housing or funding.
        </GBText>
      </Card>
    );
  }

  return (
    <Card accent={action.tone} onPress={() => onOpen(action.href)} accessibilityLabel={`Next: ${action.title}`}>
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <View
            style={{
              backgroundColor: action.soft,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 999,
            }}
          >
            <GBText variant="tag" style={{ color: action.tone }}>
              {action.tag}
            </GBText>
          </View>
          <GBText variant="tag" tone="subtle">
            Next
          </GBText>
        </View>
        <GBText variant="title">{action.title}</GBText>
        {action.body ? (
          <GBText variant="body" tone="muted">
            {action.body}
          </GBText>
        ) : null}
      </View>
    </Card>
  );
}

/**
 * An alert row.
 *
 * The mono tag plus a left border carries priority, so it survives greyscale —
 * the design's own note, and §27's requirement.
 */
function AlertRow({
  kind,
  title,
  body,
  onPress,
}: {
  kind: string;
  title: string;
  body: string | null;
  onPress: () => void;
}) {
  const { colors, space } = useTheme();

  const map: Record<string, { tag: string; tone: string }> = {
    security: { tag: "SEC", tone: colors.danger },
    deadline: { tag: "DUE", tone: colors.amber },
    document: { tag: "DOC", tone: colors.sky },
  };
  const meta = map[kind] ?? { tag: kind.slice(0, 3).toUpperCase(), tone: colors.ink5 };

  return (
    <Card accent={meta.tone} onPress={onPress} style={{ paddingVertical: space.md }} accessibilityLabel={title}>
      <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
        <GBText variant="tag" style={{ color: meta.tone, width: 34 }}>
          {meta.tag}
        </GBText>
        <View style={{ flex: 1, gap: 2 }}>
          <GBText variant="label">{title}</GBText>
          {body ? (
            <GBText variant="small" tone="subtle">
              {body}
            </GBText>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

function HomeSkeleton() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        padding: space.lg,
        paddingTop: insets.top + space.md,
        gap: space.lg,
      }}
    >
      <Skeleton height={34} width="70%" />
      <Skeleton height={18} width="45%" />
      <Skeleton height={128} />
      <Skeleton height={96} />
      <Skeleton height={96} />
    </View>
  );
}

/** A deadline is a calendar day, not an instant — never shifted by a timezone. */
function formatDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

/** A session is an instant, rendered on this device's clock. */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
