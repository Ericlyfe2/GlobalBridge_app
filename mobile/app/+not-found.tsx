import { View, Text, StyleSheet } from "react-native";
import { Link, useSegments } from "expo-router";

export default function NotFoundScreen() {
  const segments = useSegments();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>404</Text>
      <Text style={styles.subtitle}>Page not found</Text>
      <Link href="/" style={styles.link}>
        <Text style={styles.linkText}>Go home</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0A1628" },
  title: { fontSize: 48, fontWeight: "700", color: "#FFFFFF" },
  subtitle: { color: "#94A3B8", fontSize: 16, marginTop: 8 },
  link: { marginTop: 20 },
  linkText: { color: "#3B82F6", fontSize: 16 },
});
