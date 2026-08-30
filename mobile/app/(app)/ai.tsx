/**
 * AI Tools hub.
 *
 * Lists the eight AI features (§9a). Each card links to its screen.
 * The `/ai/status` endpoint tells the client which features are
 * actually usable right now — disabled features show as unavailable
 * rather than failing after the user opens them.
 */

import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { get } from "@/src/api/client";

type AiFeature = {
  key: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  route: string;
};

const FEATURES: AiFeature[] = [
  {
    key: "chat",
    title: "AI Assistant",
    description: "Ask anything about visas, housing, or life abroad.",
    icon: "chatbubble-ellipses",
    color: "#3B82F6",
    route: "/(app)/ai/chat",
  },
  {
    key: "scam-check",
    title: "Scam Shield",
    description: "Paste a message to check for scam signals.",
    icon: "shield-checkmark",
    color: "#EF4444",
    route: "/(app)/ai/scam-check",
  },
  {
    key: "doc-check",
    title: "Document Checker",
    description: "Verify your documents before submitting.",
    icon: "document-text",
    color: "#F59E0B",
    route: "/(app)/ai/doc-check",
  },
  {
    key: "visa-roadmap",
    title: "Visa Roadmap",
    description: "Get a step-by-step plan for your visa journey.",
    icon: "map",
    color: "#10B981",
    route: "/(app)/ai/visa-roadmap",
  },
  {
    key: "readiness",
    title: "Readiness Score",
    description: "See how ready you are for your move.",
    icon: "speedometer",
    color: "#8B5CF6",
    route: "/(app)/ai/readiness",
  },
  {
    key: "score-essay",
    title: "Essay Review",
    description: "Get feedback on your statement of purpose.",
    icon: "pencil",
    color: "#EC4899",
    route: "/(app)/ai/score-essay",
  },
  {
    key: "compare-countries",
    title: "Country Compare",
    description: "Compare two countries side by side.",
    icon: "globe",
    color: "#06B6D4",
    route: "/(app)/ai/compare-countries",
  },
  {
    key: "translate",
    title: "Translate",
    description: "Translate UI strings into your language.",
    icon: "language",
    color: "#F97316",
    route: "/(app)/ai/translate",
  },
];

export default function AiToolsScreen() {
  const [statusMap, setStatusMap] = useState<Record<string, boolean>>({});
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    get<{ features: Record<string, boolean>; degraded: boolean }>("/ai/status")
      .then((data) => {
        setStatusMap(data.features);
        setDegraded(data.degraded);
      })
      .catch(() => {
        // If the status endpoint fails, show all features as potentially available.
        const all: Record<string, boolean> = {};
        FEATURES.forEach((f) => { all[f.key] = true; });
        setStatusMap(all);
      });
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AI Tools</Text>
        {degraded && (
          <View style={styles.degradedBadge}>
            <Text style={styles.degradedText}>Degraded</Text>
          </View>
        )}
      </View>

      {FEATURES.map((feature) => {
        const enabled = statusMap[feature.key] !== false;
        return (
          <TouchableOpacity
            key={feature.key}
            style={[styles.card, !enabled && styles.cardDisabled]}
            onPress={() => enabled && router.push(feature.route as any)}
            disabled={!enabled}
          >
            <View style={[styles.iconContainer, { backgroundColor: feature.color + "20" }]}>
              <Ionicons name={feature.icon} size={24} color={enabled ? feature.color : "#6B7280"} />
            </View>
            <View style={styles.cardContent}>
              <Text style={[styles.cardTitle, !enabled && styles.cardTitleDisabled]}>
                {feature.title}
              </Text>
              <Text style={styles.cardDescription}>{feature.description}</Text>
            </View>
            {enabled ? (
              <Ionicons name="chevron-forward" size={18} color="#4B5563" />
            ) : (
              <Ionicons name="lock-closed" size={16} color="#6B7280" />
            )}
          </TouchableOpacity>
        );
      })}

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  content: { padding: 20, paddingTop: 60 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 },
  headerTitle: { fontSize: 28, fontWeight: "700", color: "#FFFFFF" },
  degradedBadge: {
    backgroundColor: "#78350F", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  degradedText: { color: "#FCD34D", fontSize: 11, fontWeight: "600" },
  card: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "#1E293B", borderRadius: 12, padding: 16, marginBottom: 10,
  },
  cardDisabled: { opacity: 0.5 },
  iconContainer: {
    width: 48, height: 48, borderRadius: 12, justifyContent: "center", alignItems: "center",
  },
  cardContent: { flex: 1 },
  cardTitle: { color: "#F1F5F9", fontSize: 16, fontWeight: "600", marginBottom: 2 },
  cardTitleDisabled: { color: "#6B7280" },
  cardDescription: { color: "#94A3B8", fontSize: 13 },
});
