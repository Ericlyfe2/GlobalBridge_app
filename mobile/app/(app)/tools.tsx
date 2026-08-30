import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, Skeleton } from "@/src/components/ui";
import { fetchAiStatus, fetchAiUsage, type AiStatus } from "@/src/api/endpoints";
import { useConnectivity } from "@/src/hooks/useConnectivity";

/**
 * AI Tool Center.
 *
 * ── Availability is read from the server, not assumed ─────────────────────
 * `GET /ai/status` reports which tools are actually usable: whether a model is
 * configured at all, and which features an admin has switched off. The tools
 * are disabled here from that, so a user never opens a screen, types a
 * document into it, and only then learns the feature is off.
 *
 * That is the design's own note — "'Needs signal' marks the tools that cannot
 * run offline, honest disabled states rather than a spinner" — and §11's
 * disabled-state honesty rule applied to navigation instead of to a response
 * body.
 *
 * ── Two tools stay available when the model is down ───────────────────────
 * Scam Shield and Visa Roadmap answer usefully without it: a heuristic scan
 * floored at "Be cautious", and a generic roadmap. They are shown as
 * available-but-degraded rather than hidden, because a safety tool that
 * disappears when the model is unreachable is worse than one that says it is
 * running on reduced information.
 */

type Tool = {
  key: string;
  /**
   * The key in GET /ai/status's `features` object this card gates on. Two
   * cards can point at the same backend feature with different routes -- the
   * quick text-only document check and the camera flow are one server
   * capability, presented as two entry points.
   */
  statusKey: string;
  glyph: string;
  name: string;
  note: string;
  route: string;
  tone: "brand" | "info" | "danger" | "success" | "warning";
  /** True when the tool still does something useful with no model. */
  worksDegraded: boolean;
};

const TOOLS: Tool[] = [
  {
    key: "chat",
    statusKey: "chat",
    glyph: "AI",
    name: "Visa Assistant",
    note: "Ask anything; answers cite their sources",
    route: "/assistant",
    tone: "brand",
    worksDegraded: false,
  },
  {
    key: "doc-check",
    statusKey: "doc-check",
    glyph: "DOC",
    name: "Document Checker",
    note: "Photograph a document, check expiry and gaps",
    route: "/scan",
    tone: "info",
    worksDegraded: true,
  },
  {
    key: "doc-check-quick",
    statusKey: "doc-check",
    glyph: "DOC",
    name: "Quick document check",
    note: "No photo -- pick a type and add what you know",
    route: "/ai/doc-check",
    tone: "info",
    worksDegraded: true,
  },
  {
    key: "scam-check",
    statusKey: "scam-check",
    glyph: "SS",
    name: "Scam Shield",
    note: "Paste a listing, offer or message before you pay",
    route: "/ai/scam-check",
    tone: "danger",
    worksDegraded: true,
  },
  {
    key: "visa-roadmap",
    statusKey: "visa-roadmap",
    glyph: "RM",
    name: "Visa Roadmap",
    note: "Your stages and tasks, kept up to date",
    route: "/ai/visa-roadmap",
    tone: "brand",
    worksDegraded: true,
  },
  {
    key: "readiness",
    statusKey: "readiness",
    glyph: "RS",
    name: "Readiness Score",
    note: "What is done, what is missing, what is next",
    route: "/ai/readiness",
    tone: "success",
    worksDegraded: true,
  },
  {
    key: "compare-countries",
    statusKey: "compare-countries",
    glyph: "CC",
    name: "Country Compare",
    note: "Two destinations side by side, sourced",
    route: "/ai/compare-countries",
    tone: "warning",
    worksDegraded: false,
  },
  {
    key: "score-essay",
    statusKey: "score-essay",
    glyph: "SoP",
    name: "Essay / SoP review",
    note: "Structured feedback, never a rewrite",
    route: "/ai/score-essay",
    tone: "info",
    worksDegraded: false,
  },
  {
    key: "translate",
    statusKey: "translate",
    glyph: "TR",
    name: "Translate",
    note: "Batch-translate text into your language",
    route: "/ai/translate",
    tone: "warning",
    worksDegraded: false,
  },
];

export default function ToolsScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { online } = useConnectivity();

  const [status, setStatus] = useState<AiStatus | null>(null);
  const [usage, setUsage] = useState<{ spent_usd: number; limit_usd: number; exceeded: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([
        fetchAiStatus(),
        fetchAiUsage().catch(() => null),
      ]);
      setStatus(s);
      if (u) setUsage(u);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.md,
        paddingBottom: space.xxl,
        gap: space.md,
      }}
    >
      <View style={{ gap: 4 }}>
        <GBText variant="title">AI Tool Center</GBText>
        <GBText variant="small" tone="subtle">
          Every tool guides and cites. None of them speaks for a government.
        </GBText>
      </View>

      {usage?.exceeded ? (
        <Card accent={colors.amber}>
          <Badge label="Daily limit reached" tone="warning" glyph="!" />
          <GBText variant="small" tone="muted" style={{ marginTop: 6 }}>
            You have used today's AI allowance. It resets at midnight UTC.
            Everything else in the app still works.
          </GBText>
        </Card>
      ) : null}

      {loading ? (
        <View style={{ gap: space.sm }}>
          <Skeleton height={78} />
          <Skeleton height={78} />
          <Skeleton height={78} />
        </View>
      ) : (
        TOOLS.map((tool) => {
          // Absent a status response, assume nothing works rather than letting
          // the user walk into a dead screen.
          const serverEnabled = status ? (status.features[tool.statusKey] ?? false) : false;
          const blockedByNetwork = !online && !tool.worksDegraded;
          const available = serverEnabled && !blockedByNetwork;

          const reason = blockedByNetwork
            ? "Needs signal"
            : !serverEnabled
              ? status
                ? "Switched off"
                : "Unavailable"
              : undefined;

          return (
            <Card
              key={tool.key}
              onPress={available ? () => router.push(tool.route as never) : undefined}
              accessibilityLabel={`${tool.name}${reason ? `, ${reason}` : ""}`}
              style={{ opacity: available ? 1 : 0.55 }}
            >
              <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: radius.md,
                    backgroundColor: colors.alt,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <GBText variant="tag" tone="brand">
                    {tool.glyph}
                  </GBText>
                </View>

                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                    <GBText variant="label" style={{ flex: 1 }}>
                      {tool.name}
                    </GBText>
                    {reason ? <Badge label={reason} tone="neutral" glyph="—" /> : null}
                  </View>
                  <GBText variant="small" tone="subtle">
                    {tool.note}
                  </GBText>
                  {available && !online && tool.worksDegraded ? (
                    <GBText variant="small" tone="warning">
                      Runs on reduced information while you are offline.
                    </GBText>
                  ) : null}
                </View>
              </View>
            </Card>
          );
        })
      )}

      {status && !status.configured ? (
        <Card>
          <GBText variant="small" tone="muted">
            The AI service is not configured on this server. Scam Shield and the
            roadmap still run on built-in checks; the rest need a model.
          </GBText>
        </Card>
      ) : null}
    </ScrollView>
  );
}
