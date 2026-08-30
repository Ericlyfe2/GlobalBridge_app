/**
 * Scam Shield.
 *
 * POST /ai/scam-check — the most safety-critical screen in the app.
 * A scam checker that fails open reads as approval, and this audience is
 * actively targeted by scams (§9a).
 */

import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { post } from "@/src/api/client";

type Flag = {
  phrase: string;
  category: string;
  why: string;
  severity: "low" | "med" | "high";
};

type ScamResult = {
  score: number;
  verdict: "Likely safe" | "Be cautious" | "High scam risk";
  summary: string;
  flags: Flag[];
  advice: string[];
  degraded?: boolean;
  disabled?: boolean;
};

const SEVERITY_COLOR = { low: "#F59E0B", med: "#F97316", high: "#EF4444" };
const VERDICT_COLOR = {
  "Likely safe": "#10B981",
  "Be cautious": "#F59E0B",
  "High scam risk": "#EF4444",
};

export default function ScamCheckScreen() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ScamResult | null>(null);
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await post<ScamResult>("/ai/scam-check", { text: text.trim() });
      setResult(res);
    } catch {
      setResult({
        score: 50,
        verdict: "Be cautious",
        summary: "Could not analyze this message. Please try again.",
        flags: [],
        advice: ["Use your own judgement and verify before paying."],
        degraded: true,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Ionicons name="shield-checkmark" size={28} color="#EF4444" />
          <Text style={styles.headerTitle}>Scam Shield</Text>
        </View>
        <Text style={styles.subtitle}>
          Paste a message, listing, or email to check for scam signals.
        </Text>

        <TextInput
          style={styles.textInput}
          placeholder="Paste the message here..."
          placeholderTextColor="#6B7280"
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={6}
          maxLength={6000}
        />

        <TouchableOpacity
          style={[styles.analyzeButton, (!text.trim() || loading) && styles.buttonDisabled]}
          onPress={analyze}
          disabled={!text.trim() || loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.analyzeText}>Check for scams</Text>
          )}
        </TouchableOpacity>

        {/* Result */}
        {result && (
          <View style={styles.resultCard}>
            {result.degraded && (
              <View style={styles.degradedBanner}>
                <Text style={styles.degradedText}>⚠ Basic scan only — AI unavailable</Text>
              </View>
            )}

            <View style={styles.scoreRow}>
              <Text style={[styles.verdict, { color: VERDICT_COLOR[result.verdict] }]}>
                {result.verdict}
              </Text>
              <Text style={styles.score}>{result.score}/100</Text>
            </View>

            <Text style={styles.summary}>{result.summary}</Text>

            {result.flags.length > 0 && (
              <View style={styles.flagsSection}>
                <Text style={styles.flagsTitle}>Warning signs</Text>
                {result.flags.map((flag, i) => (
                  <View key={i} style={styles.flag}>
                    <View style={[styles.flagDot, { backgroundColor: SEVERITY_COLOR[flag.severity] }]} />
                    <View style={styles.flagContent}>
                      <Text style={styles.flagCategory}>{flag.category}</Text>
                      <Text style={styles.flagPhrase}>"{flag.phrase}"</Text>
                      <Text style={styles.flagWhy}>{flag.why}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {result.advice.length > 0 && (
              <View style={styles.adviceSection}>
                <Text style={styles.adviceTitle}>What to do</Text>
                {result.advice.map((tip, i) => (
                  <Text key={i} style={styles.adviceItem}>• {tip}</Text>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  headerTitle: { fontSize: 24, fontWeight: "700", color: "#FFFFFF" },
  subtitle: { color: "#94A3B8", fontSize: 14, marginBottom: 16 },
  textInput: {
    backgroundColor: "#1E293B", borderRadius: 12, padding: 14,
    color: "#FFFFFF", fontSize: 15, minHeight: 120, textAlignVertical: "top",
    borderWidth: 1, borderColor: "#374151", marginBottom: 12,
  },
  analyzeButton: {
    backgroundColor: "#EF4444", borderRadius: 12, paddingVertical: 14,
    alignItems: "center", marginBottom: 20,
  },
  buttonDisabled: { opacity: 0.4 },
  analyzeText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },

  resultCard: { backgroundColor: "#1E293B", borderRadius: 12, padding: 16 },
  degradedBanner: {
    backgroundColor: "#78350F", borderRadius: 8, padding: 10, marginBottom: 12,
  },
  degradedText: { color: "#FCD34D", fontSize: 13, textAlign: "center" },
  scoreRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  verdict: { fontSize: 20, fontWeight: "700" },
  score: { color: "#94A3B8", fontSize: 14 },
  summary: { color: "#CBD5E1", fontSize: 14, lineHeight: 20, marginBottom: 16 },

  flagsSection: { marginBottom: 16 },
  flagsTitle: { color: "#F1F5F9", fontSize: 15, fontWeight: "600", marginBottom: 8 },
  flag: { flexDirection: "row", gap: 10, marginBottom: 10 },
  flagDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  flagContent: { flex: 1 },
  flagCategory: { color: "#F1F5F9", fontSize: 13, fontWeight: "600" },
  flagPhrase: { color: "#F87171", fontSize: 13, fontStyle: "italic", marginVertical: 2 },
  flagWhy: { color: "#94A3B8", fontSize: 12 },

  adviceSection: { borderTopWidth: 1, borderTopColor: "#334155", paddingTop: 12 },
  adviceTitle: { color: "#F1F5F9", fontSize: 15, fontWeight: "600", marginBottom: 6 },
  adviceItem: { color: "#CBD5E1", fontSize: 13, lineHeight: 20, marginBottom: 4 },
});
