/**
 * Essay Review.
 *
 * POST /ai/score-essay — scores essays against a rubric.
 * Returns 503 rather than a fabricated review (§9a).
 */

import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { post } from "@/src/api/client";

const DOC_TYPES = [
  { value: "sop", label: "Statement of Purpose" },
  { value: "personal_statement", label: "Personal Statement" },
  { value: "scholarship_essay", label: "Scholarship Essay" },
  { value: "motivation_letter", label: "Motivation Letter" },
  { value: "cover_letter", label: "Cover Letter" },
] as const;

type EssayResult = {
  overall: number;
  sections?: Array<{
    id: string;
    label: string;
    score: number;
    tone: string;
    comment: string;
  }>;
  tips?: string[];
};

export default function ScoreEssayScreen() {
  const [essay, setEssay] = useState("");
  const [docType, setDocType] = useState("sop");
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<EssayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    if (!essay.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await post<EssayResult>("/ai/score-essay", {
        essay: essay.trim(),
        docType,
        target: target.trim() || undefined,
      });
      setResult(res);
    } catch (err: any) {
      if (err?.response?.status === 503) {
        setError("Essay review is temporarily unavailable. Your draft is safe.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Ionicons name="pencil" size={28} color="#EC4899" />
        <Text style={styles.headerTitle}>Essay Review</Text>
      </View>

      <Text style={styles.label}>Document type</Text>
      <View style={styles.typeRow}>
        {DOC_TYPES.map((dt) => (
          <TouchableOpacity
            key={dt.value}
            style={[styles.typeChip, docType === dt.value && styles.typeChipActive]}
            onPress={() => setDocType(dt.value)}
          >
            <Text style={[styles.typeText, docType === dt.value && styles.typeTextActive]}>
              {dt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        style={styles.input}
        placeholder="Target institution or company (optional)"
        placeholderTextColor="#6B7280"
        value={target}
        onChangeText={setTarget}
      />

      <TextInput
        style={styles.essayInput}
        placeholder="Paste your essay draft here..."
        placeholderTextColor="#6B7280"
        value={essay}
        onChangeText={setEssay}
        multiline
        maxLength={20000}
      />

      <TouchableOpacity
        style={[styles.analyzeButton, (!essay.trim() || loading) && styles.buttonDisabled]}
        onPress={analyze}
        disabled={!essay.trim() || loading}
      >
        {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.analyzeText}>Review essay</Text>}
      </TouchableOpacity>

      {error && (
        <View style={styles.errorCard}>
          <Ionicons name="warning" size={20} color="#F59E0B" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {result && (
        <View style={styles.resultCard}>
          <View style={styles.scoreRow}>
            <Text style={styles.scoreLabel}>Overall</Text>
            <Text style={[styles.scoreValue, { color: result.overall >= 70 ? "#10B981" : result.overall >= 50 ? "#F59E0B" : "#EF4444" }]}>
              {result.overall}/100
            </Text>
          </View>

          {result.sections?.map((s) => (
            <View key={s.id} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>{s.label}</Text>
                <Text style={styles.sectionScore}>{s.score}/100</Text>
              </View>
              <Text style={styles.sectionComment}>{s.comment}</Text>
            </View>
          ))}

          {result.tips && result.tips.length > 0 && (
            <View style={styles.tipsSection}>
              <Text style={styles.tipsTitle}>Top improvements</Text>
              {result.tips.map((tip, i) => (
                <Text key={i} style={styles.tipItem}>{i + 1}. {tip}</Text>
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
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  headerTitle: { fontSize: 24, fontWeight: "700", color: "#FFFFFF" },
  label: { color: "#9CA3AF", fontSize: 13, fontWeight: "600", marginBottom: 8 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  typeChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: "#1E293B", borderWidth: 1, borderColor: "#374151",
  },
  typeChipActive: { backgroundColor: "#831843", borderColor: "#EC4899" },
  typeText: { color: "#94A3B8", fontSize: 12 },
  typeTextActive: { color: "#F9A8D4" },
  input: {
    backgroundColor: "#1E293B", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    color: "#FFFFFF", fontSize: 14, borderWidth: 1, borderColor: "#374151", marginBottom: 12,
  },
  essayInput: {
    backgroundColor: "#1E293B", borderRadius: 12, padding: 14,
    color: "#FFFFFF", fontSize: 14, minHeight: 160, textAlignVertical: "top",
    borderWidth: 1, borderColor: "#374151", marginBottom: 12,
  },
  analyzeButton: {
    backgroundColor: "#EC4899", borderRadius: 12, paddingVertical: 14, alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  analyzeText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  errorCard: {
    flexDirection: "row", gap: 10, backgroundColor: "#78350F",
    borderRadius: 12, padding: 14, marginTop: 20, alignItems: "center",
  },
  errorText: { color: "#FCD34D", fontSize: 14, flex: 1 },
  resultCard: { backgroundColor: "#1E293B", borderRadius: 12, padding: 16, marginTop: 20 },
  scoreRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  scoreLabel: { color: "#F1F5F9", fontSize: 18, fontWeight: "700" },
  scoreValue: { fontSize: 28, fontWeight: "700" },
  section: { marginBottom: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "#334155" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between" },
  sectionLabel: { color: "#E2E8F0", fontSize: 14, fontWeight: "500" },
  sectionScore: { color: "#94A3B8", fontSize: 13 },
  sectionComment: { color: "#94A3B8", fontSize: 12, marginTop: 4 },
  tipsSection: { marginTop: 8 },
  tipsTitle: { color: "#F1F5F9", fontSize: 15, fontWeight: "600", marginBottom: 8 },
  tipItem: { color: "#CBD5E1", fontSize: 13, lineHeight: 20, marginBottom: 4 },
});
