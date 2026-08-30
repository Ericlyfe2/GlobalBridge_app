/**
 * Country Compare.
 *
 * POST /ai/compare-countries — side-by-side country comparison.
 * Returns 503 if no model is configured (§9a).
 */

import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { post } from "@/src/api/client";

const COUNTRIES: Record<string, string> = {
  gh: "Ghana", ng: "Nigeria", ke: "Kenya", za: "South Africa",
  in: "India", pk: "Pakistan", bd: "Bangladesh", lk: "Sri Lanka",
  vn: "Vietnam", ph: "Philippines", id: "Indonesia",
  ca: "Canada", us: "United States", gb: "United Kingdom",
  de: "Germany", fr: "France", au: "Australia", nz: "New Zealand",
  jp: "Japan", kr: "South Korea", br: "Brazil", mx: "Mexico",
};

type CompareResult = {
  categories?: Array<{ label: string; country1: string; country2: string; icon: string }>;
  summary?: string;
  verdict?: string;
};

export default function CompareCountriesScreen() {
  const [code1, setCode1] = useState("");
  const [code2, setCode2] = useState("");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const compare = async () => {
    if (!code1.trim() || !code2.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await post<CompareResult>("/ai/compare-countries", {
        country1: code1.trim().toLowerCase(),
        country2: code2.trim().toLowerCase(),
      });
      setResult(res);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Could not compare these countries.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Ionicons name="globe" size={28} color="#06B6D4" />
        <Text style={styles.headerTitle}>Country Compare</Text>
      </View>

      <Text style={styles.label}>Country codes (ISO-2, e.g. gh, ca)</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Country 1"
          placeholderTextColor="#6B7280"
          value={code1}
          onChangeText={(t) => setCode1(t.slice(0, 2))}
          autoCapitalize="characters"
          maxLength={2}
        />
        <Text style={styles.vs}>vs</Text>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Country 2"
          placeholderTextColor="#6B7280"
          value={code2}
          onChangeText={(t) => setCode2(t.slice(0, 2))}
          autoCapitalize="characters"
          maxLength={2}
        />
      </View>

      <TouchableOpacity
        style={[styles.compareButton, (!code1.trim() || !code2.trim() || loading) && styles.buttonDisabled]}
        onPress={compare}
        disabled={!code1.trim() || !code2.trim() || loading}
      >
        {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.compareText}>Compare</Text>}
      </TouchableOpacity>

      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {result && (
        <View style={styles.resultCard}>
          {result.categories?.map((cat, i) => (
            <View key={i} style={styles.category}>
              <Text style={styles.catLabel}>{cat.label}</Text>
              <View style={styles.catRow}>
                <Text style={styles.catCountry}>{cat.country1}</Text>
                <Text style={styles.catCountry}>{cat.country2}</Text>
              </View>
            </View>
          ))}
          {result.summary && <Text style={styles.summary}>{result.summary}</Text>}
          {result.verdict && <Text style={styles.verdict}>{result.verdict}</Text>}
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
  label: { color: "#9CA3AF", fontSize: 13, marginBottom: 8 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  input: {
    backgroundColor: "#1E293B", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    color: "#FFFFFF", fontSize: 18, fontWeight: "600", textAlign: "center",
    borderWidth: 1, borderColor: "#374151",
  },
  vs: { color: "#6B7280", fontSize: 16, fontWeight: "600" },
  compareButton: {
    backgroundColor: "#06B6D4", borderRadius: 12, paddingVertical: 14, alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  compareText: { color: "#000", fontSize: 16, fontWeight: "600" },
  errorCard: { backgroundColor: "#7F1D1D", borderRadius: 12, padding: 14, marginTop: 20 },
  errorText: { color: "#FCA5A5", fontSize: 14 },
  resultCard: { backgroundColor: "#1E293B", borderRadius: 12, padding: 16, marginTop: 20 },
  category: { marginBottom: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "#334155" },
  catLabel: { color: "#94A3B8", fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginBottom: 4 },
  catRow: { flexDirection: "row", justifyContent: "space-between" },
  catCountry: { color: "#E2E8F0", fontSize: 14, flex: 1 },
  summary: { color: "#CBD5E1", fontSize: 13, lineHeight: 20, marginTop: 12 },
  verdict: { color: "#94A3B8", fontSize: 13, lineHeight: 20, marginTop: 8, fontStyle: "italic" },
});
