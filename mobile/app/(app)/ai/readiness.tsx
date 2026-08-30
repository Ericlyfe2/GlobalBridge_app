/**
 * Readiness Score.
 *
 * POST /ai/readiness — self-report across five pillars, get coached actions.
 * The score is computed here, not by the model (§9a).
 */

import { useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { post } from "@/src/api/client";

const PILLARS = [
  { key: "documents", label: "Documents", icon: "document-text" as const, color: "#3B82F6" },
  { key: "finances", label: "Finances", icon: "wallet" as const, color: "#10B981" },
  { key: "housing", label: "Housing", icon: "home" as const, color: "#F59E0B" },
  { key: "job", label: "Job / Income", icon: "briefcase" as const, color: "#8B5CF6" },
  { key: "community", label: "Community", icon: "people" as const, color: "#EC4899" },
] as const;

type ReadinessResult = {
  overall: number;
  pillars: Array<{ key: string; label: string; score: number; note: string }>;
  actions: Array<{ title: string; detail: string; pillar: string }>;
};

export default function ReadinessScreen() {
  const [scores, setScores] = useState<Record<string, number>>({
    documents: 50, finances: 50, housing: 50, job: 50, community: 50,
  });
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    setLoading(true);
    try {
      const res = await post<ReadinessResult>("/ai/readiness", { pillars: scores });
      setResult(res);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Ionicons name="speedometer" size={28} color="#8B5CF6" />
        <Text style={styles.headerTitle}>Readiness Score</Text>
      </View>
      <Text style={styles.subtitle}>Rate your progress across each pillar.</Text>

      {PILLARS.map((p) => (
        <View key={p.key} style={styles.sliderCard}>
          <View style={styles.sliderHeader}>
            <Ionicons name={p.icon} size={18} color={p.color} />
            <Text style={styles.sliderLabel}>{p.label}</Text>
            <Text style={styles.sliderValue}>{scores[p.key]}/100</Text>
          </View>
          <View style={styles.sliderTrack}>
            <View style={[styles.sliderFill, { width: `${scores[p.key]}%`, backgroundColor: p.color }]} />
          </View>
          <View style={styles.sliderButtons}>
            {[0, 25, 50, 75, 100].map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.sliderPreset, scores[p.key] === v && { backgroundColor: p.color + "40" }]}
                onPress={() => setScores((prev) => ({ ...prev, [p.key]: v }))}
              >
                <Text style={[styles.presetText, scores[p.key] === v && { color: p.color }]}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.analyzeButton, loading && styles.buttonDisabled]}
        onPress={analyze}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.analyzeText}>Get my score</Text>}
      </TouchableOpacity>

      {result && (
        <View style={styles.resultCard}>
          <Text style={styles.overallLabel}>Overall readiness</Text>
          <Text style={styles.overallScore}>{result.overall}/100</Text>

          {result.pillars.map((p) => (
            <View key={p.key} style={styles.pillarRow}>
              <Text style={styles.pillarName}>{p.label}</Text>
              <Text style={styles.pillarScore}>{p.score}</Text>
              <Text style={styles.pillarNote}>{p.note}</Text>
            </View>
          ))}

          {result.actions.length > 0 && (
            <View style={styles.actionsSection}>
              <Text style={styles.actionsTitle}>Next steps</Text>
              {result.actions.map((a, i) => (
                <View key={i} style={styles.action}>
                  <Text style={styles.actionTitle}>{a.title}</Text>
                  <Text style={styles.actionDetail}>{a.detail}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  headerTitle: { fontSize: 24, fontWeight: "700", color: "#FFFFFF" },
  subtitle: { color: "#94A3B8", fontSize: 14, marginBottom: 20 },
  sliderCard: { backgroundColor: "#1E293B", borderRadius: 12, padding: 14, marginBottom: 10 },
  sliderHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  sliderLabel: { color: "#E2E8F0", fontSize: 14, fontWeight: "500", flex: 1 },
  sliderValue: { color: "#94A3B8", fontSize: 13 },
  sliderTrack: { height: 6, backgroundColor: "#334155", borderRadius: 3, marginBottom: 8 },
  sliderFill: { height: 6, borderRadius: 3 },
  sliderButtons: { flexDirection: "row", justifyContent: "space-between" },
  sliderPreset: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6 },
  presetText: { color: "#6B7280", fontSize: 12 },
  analyzeButton: {
    backgroundColor: "#8B5CF6", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 8,
  },
  buttonDisabled: { opacity: 0.4 },
  analyzeText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  resultCard: { backgroundColor: "#1E293B", borderRadius: 12, padding: 16, marginTop: 20 },
  overallLabel: { color: "#94A3B8", fontSize: 14 },
  overallScore: { color: "#FFFFFF", fontSize: 36, fontWeight: "700", marginBottom: 16 },
  pillarRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  pillarName: { color: "#CBD5E1", fontSize: 13, width: 90 },
  pillarScore: { color: "#94A3B8", fontSize: 13, width: 30, textAlign: "right" },
  pillarNote: { color: "#64748B", fontSize: 12, flex: 1 },
  actionsSection: { borderTopWidth: 1, borderTopColor: "#334155", paddingTop: 12, marginTop: 8 },
  actionsTitle: { color: "#F1F5F9", fontSize: 15, fontWeight: "600", marginBottom: 8 },
  action: { marginBottom: 10 },
  actionTitle: { color: "#E2E8F0", fontSize: 14, fontWeight: "500" },
  actionDetail: { color: "#94A3B8", fontSize: 12, marginTop: 2 },
});
