/**
 * Translate.
 *
 * POST /ai/translate — batch UI string translation.
 * Returns source strings when unavailable (§9a).
 */

import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { post } from "@/src/api/client";

const LANGUAGES = [
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "de", label: "German" },
  { code: "ar", label: "Arabic" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "hi", label: "Hindi" },
  { code: "sw", label: "Swahili" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "tr", label: "Turkish" },
];

export default function TranslateScreen() {
  const [input, setInput] = useState("");
  const [target, setTarget] = useState("fr");
  const [result, setResult] = useState<string[] | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(false);

  const translate = async () => {
    const texts = input.split("\n").filter((l) => l.trim());
    if (texts.length === 0) return;
    setLoading(true);
    try {
      const res = await post<{ translations: string[]; degraded?: boolean }>(
        "/ai/translate",
        { texts, target },
      );
      setResult(res.translations);
      setDegraded(!!res.degraded);
    } catch {
      setResult(texts);
      setDegraded(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Ionicons name="language" size={28} color="#F97316" />
        <Text style={styles.headerTitle}>Translate</Text>
      </View>

      <Text style={styles.label}>Target language</Text>
      <View style={styles.langRow}>
        {LANGUAGES.map((lang) => (
          <TouchableOpacity
            key={lang.code}
            style={[styles.langChip, target === lang.code && styles.langChipActive]}
            onPress={() => setTarget(lang.code)}
          >
            <Text style={[styles.langText, target === lang.code && styles.langTextActive]}>
              {lang.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        style={styles.textInput}
        placeholder="Enter text to translate (one line per string)..."
        placeholderTextColor="#6B7280"
        value={input}
        onChangeText={setInput}
        multiline
      />

      <TouchableOpacity
        style={[styles.translateButton, (!input.trim() || loading) && styles.buttonDisabled]}
        onPress={translate}
        disabled={!input.trim() || loading}
      >
        {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.translateText}>Translate</Text>}
      </TouchableOpacity>

      {result && (
        <View style={styles.resultCard}>
          {degraded && (
            <View style={styles.degradedBanner}>
              <Text style={styles.degradedText}>⚠ Degraded — AI unavailable, source text returned</Text>
            </View>
          )}
          {result.map((line, i) => (
            <View key={i} style={styles.line}>
              <Text style={styles.lineNumber}>{i + 1}</Text>
              <Text style={styles.lineText}>{line}</Text>
            </View>
          ))}
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
  langRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  langChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: "#1E293B", borderWidth: 1, borderColor: "#374151",
  },
  langChipActive: { backgroundColor: "#7C2D12", borderColor: "#F97316" },
  langText: { color: "#94A3B8", fontSize: 13 },
  langTextActive: { color: "#FDBA74" },
  textInput: {
    backgroundColor: "#1E293B", borderRadius: 12, padding: 14,
    color: "#FFFFFF", fontSize: 15, minHeight: 120, textAlignVertical: "top",
    borderWidth: 1, borderColor: "#374151", marginBottom: 12,
  },
  translateButton: {
    backgroundColor: "#F97316", borderRadius: 12, paddingVertical: 14, alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  translateText: { color: "#000", fontSize: 16, fontWeight: "600" },
  resultCard: { backgroundColor: "#1E293B", borderRadius: 12, padding: 16, marginTop: 20 },
  degradedBanner: { backgroundColor: "#78350F", borderRadius: 8, padding: 10, marginBottom: 12 },
  degradedText: { color: "#FCD34D", fontSize: 13, textAlign: "center" },
  line: { flexDirection: "row", gap: 10, marginBottom: 8 },
  lineNumber: { color: "#6B7280", fontSize: 13, width: 24 },
  lineText: { color: "#E2E8F0", fontSize: 14, flex: 1 },
});
