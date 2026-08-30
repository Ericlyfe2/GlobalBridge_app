/**
 * Visa Roadmap.
 *
 * POST /ai/visa-roadmap — generates a step-by-step plan.
 * The fallback roadmap is generic and flagged `degraded` (§9a).
 */

import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { post } from "@/src/api/client";

type Phase = {
  id: string;
  title: string;
  timeframe: string;
  cost: string;
  documents: string[];
  tip: string;
};

type RoadmapResult = {
  title: string;
  totalWeeks: number;
  phases: Phase[];
  estimates_only?: boolean;
  degraded?: boolean;
};

export default function VisaRoadmapScreen() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState<"study" | "work" | "settle">("study");
  const [result, setResult] = useState<RoadmapResult | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!origin.trim() || !destination.trim()) return;
    setLoading(true);
    try {
      const res = await post<RoadmapResult>("/ai/visa-roadmap", {
        origin: origin.trim(),
        destination: destination.trim(),
        purpose,
      });
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
        <Ionicons name="map" size={28} color="#10B981" />
        <Text style={styles.headerTitle}>Visa Roadmap</Text>
      </View>

      <TextInput
        style={styles.input}
        placeholder="Origin country"
        placeholderTextColor="#6B7280"
        value={origin}
        onChangeText={setOrigin}
      />
      <TextInput
        style={styles.input}
        placeholder="Destination country"
        placeholderTextColor="#6B7280"
        value={destination}
        onChangeText={setDestination}
      />

      <View style={styles.purposeRow}>
        {(["study", "work", "settle"] as const).map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.purposeChip, purpose === p && styles.purposeChipActive]}
            onPress={() => setPurpose(p)}
          >
            <Text style={[styles.purposeText, purpose === p && styles.purposeTextActive]}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.generateButton, (!origin.trim() || !destination.trim() || loading) && styles.buttonDisabled]}
        onPress={generate}
        disabled={!origin.trim() || !destination.trim() || loading}
      >
        {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.generateText}>Generate roadmap</Text>}
      </TouchableOpacity>

      {result && (
        <View style={styles.resultCard}>
          {result.degraded && (
            <View style={styles.degradedBanner}>
              <Text style={styles.degradedText}>⚠ Generic roadmap — AI unavailable</Text>
            </View>
          )}
          <Text style={styles.title}>{result.title}</Text>
          <Text style={styles.totalWeeks}>≈ {result.totalWeeks} weeks</Text>

          {result.phases.map((phase, i) => (
            <View key={phase.id} style={styles.phase}>
              <View style={styles.phaseHeader}>
                <View style={styles.phaseNumber}>
                  <Text style={styles.phaseNumberText}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.phaseTitle}>{phase.title}</Text>
                  <Text style={styles.phaseTime}>{phase.timeframe} · {phase.cost}</Text>
                </View>
              </View>
              {phase.documents.length > 0 && (
                <Text style={styles.phaseDocs}>
                  Documents: {phase.documents.join(", ")}
                </Text>
              )}
              <Text style={styles.phaseTip}>💡 {phase.tip}</Text>
            </View>
          ))}

          {result.estimates_only && (
            <Text style={styles.disclaimer}>
              Costs and timeframes are estimates. Verify on the official government site.
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 },
  headerTitle: { fontSize: 24, fontWeight: "700", color: "#FFFFFF" },
  input: {
    backgroundColor: "#1E293B", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: "#FFFFFF", fontSize: 15, borderWidth: 1, borderColor: "#374151", marginBottom: 12,
  },
  purposeRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  purposeChip: {
    flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center",
    backgroundColor: "#1E293B", borderWidth: 1, borderColor: "#374151",
  },
  purposeChipActive: { backgroundColor: "#064E3B", borderColor: "#10B981" },
  purposeText: { color: "#94A3B8", fontSize: 14, fontWeight: "500" },
  purposeTextActive: { color: "#6EE7B7" },
  generateButton: {
    backgroundColor: "#10B981", borderRadius: 12, paddingVertical: 14, alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  generateText: { color: "#000", fontSize: 16, fontWeight: "600" },
  resultCard: { backgroundColor: "#1E293B", borderRadius: 12, padding: 16, marginTop: 20 },
  degradedBanner: { backgroundColor: "#78350F", borderRadius: 8, padding: 10, marginBottom: 12 },
  degradedText: { color: "#FCD34D", fontSize: 13, textAlign: "center" },
  title: { color: "#F1F5F9", fontSize: 18, fontWeight: "700", marginBottom: 2 },
  totalWeeks: { color: "#94A3B8", fontSize: 13, marginBottom: 16 },
  phase: { marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#334155" },
  phaseHeader: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  phaseNumber: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: "#10B981",
    justifyContent: "center", alignItems: "center",
  },
  phaseNumberText: { color: "#000", fontSize: 13, fontWeight: "700" },
  phaseTitle: { color: "#E2E8F0", fontSize: 15, fontWeight: "600" },
  phaseTime: { color: "#94A3B8", fontSize: 12, marginTop: 2 },
  phaseDocs: { color: "#64748B", fontSize: 12, marginTop: 6, marginLeft: 40 },
  phaseTip: { color: "#94A3B8", fontSize: 12, marginTop: 4, marginLeft: 40, fontStyle: "italic" },
  disclaimer: { color: "#64748B", fontSize: 11, fontStyle: "italic", marginTop: 8, textAlign: "center" },
});
