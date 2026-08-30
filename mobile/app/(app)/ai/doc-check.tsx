/**
 * Document Checker.
 *
 * POST /ai/doc-check — reasons about what governments commonly reject.
 * Never sees the file; reasons from declared type and metadata (§9a).
 */

import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { post } from "@/src/api/client";

type Finding = {
  id: string;
  label: string;
  detail: string;
  severity: "ok" | "warn" | "fail";
};

type DocResult = {
  score: number;
  label: string;
  summary: string;
  findings: Finding[];
  degraded?: boolean;
};

const DOC_TYPES = [
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID" },
  { value: "bank_statement", label: "Bank Statement" },
  { value: "transcript", label: "Transcript" },
  { value: "acceptance_letter", label: "Acceptance Letter" },
  { value: "study_permit", label: "Study Permit" },
  { value: "insurance", label: "Insurance" },
  { value: "other", label: "Other" },
] as const;

const SEVERITY_ICON = { ok: "checkmark-circle", warn: "alert-circle", fail: "close-circle" } as const;
const SEVERITY_COLOR = { ok: "#10B981", warn: "#F59E0B", fail: "#EF4444" };

export default function DocCheckScreen() {
  const [docType, setDocType] = useState<string>("passport");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<DocResult | null>(null);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    setLoading(true);
    try {
      const res = await post<DocResult>("/ai/doc-check", {
        docType,
        notes: notes.trim() || undefined,
      });
      setResult(res);
    } catch {
      setResult(null);
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
          <Ionicons name="document-text" size={28} color="#F59E0B" />
          <Text style={styles.headerTitle}>Document Checker</Text>
        </View>
        <Text style={styles.subtitle}>
          Select your document type and add notes. We'll check common rejection triggers.
        </Text>

        {/* Doc type selector */}
        <Text style={styles.label}>Document type</Text>
        <View style={styles.typeGrid}>
          {DOC_TYPES.map((dt) => (
            <TouchableOpacity
              key={dt.value}
              style={[styles.typeChip, docType === dt.value && styles.typeChipActive]}
              onPress={() => setDocType(dt.value)}
            >
              <Text style={[styles.typeChipText, docType === dt.value && styles.typeChipTextActive]}>
                {dt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={styles.textInput}
          placeholder="Optional notes (name on document, expiry date, etc.)"
          placeholderTextColor="#6B7280"
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
          maxLength={30000}
        />

        <TouchableOpacity
          style={[styles.checkButton, loading && styles.buttonDisabled]}
          onPress={check}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.checkText}>Check document</Text>}
        </TouchableOpacity>

        {result && (
          <View style={styles.resultCard}>
            {result.degraded && (
              <View style={styles.degradedBanner}>
                <Text style={styles.degradedText}>⚠ Basic checklist — AI unavailable</Text>
              </View>
            )}
            <Text style={styles.resultLabel}>{result.label}</Text>
            <Text style={styles.resultSummary}>{result.summary}</Text>
            {result.findings.map((f) => (
              <View key={f.id} style={styles.finding}>
                <Ionicons name={SEVERITY_ICON[f.severity]} size={18} color={SEVERITY_COLOR[f.severity]} />
                <View style={styles.findingContent}>
                  <Text style={styles.findingLabel}>{f.label}</Text>
                  <Text style={styles.findingDetail}>{f.detail}</Text>
                </View>
              </View>
            ))}
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
  label: { color: "#9CA3AF", fontSize: 13, fontWeight: "600", marginBottom: 8 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  typeChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: "#1E293B", borderWidth: 1, borderColor: "#374151",
  },
  typeChipActive: { backgroundColor: "#78350F", borderColor: "#F59E0B" },
  typeChipText: { color: "#94A3B8", fontSize: 13 },
  typeChipTextActive: { color: "#FCD34D" },
  textInput: {
    backgroundColor: "#1E293B", borderRadius: 12, padding: 14,
    color: "#FFFFFF", fontSize: 15, minHeight: 80, textAlignVertical: "top",
    borderWidth: 1, borderColor: "#374151", marginBottom: 12,
  },
  checkButton: {
    backgroundColor: "#F59E0B", borderRadius: 12, paddingVertical: 14, alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  checkText: { color: "#000", fontSize: 16, fontWeight: "600" },
  resultCard: { backgroundColor: "#1E293B", borderRadius: 12, padding: 16, marginTop: 20 },
  degradedBanner: { backgroundColor: "#78350F", borderRadius: 8, padding: 10, marginBottom: 12 },
  degradedText: { color: "#FCD34D", fontSize: 13, textAlign: "center" },
  resultLabel: { color: "#F1F5F9", fontSize: 18, fontWeight: "700", marginBottom: 4 },
  resultSummary: { color: "#94A3B8", fontSize: 13, marginBottom: 16 },
  finding: { flexDirection: "row", gap: 10, marginBottom: 12 },
  findingContent: { flex: 1 },
  findingLabel: { color: "#E2E8F0", fontSize: 14, fontWeight: "500" },
  findingDetail: { color: "#94A3B8", fontSize: 12, marginTop: 2 },
});
