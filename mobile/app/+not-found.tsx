import { View } from "react-native";
import { Link } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText } from "@/src/components/ui";

export default function NotFoundScreen() {
  const { colors, space } = useTheme();

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg }}>
      <GBText variant="display">404</GBText>
      <GBText variant="body" tone="muted" style={{ marginTop: space.sm }}>
        Page not found
      </GBText>
      <Link href="/" style={{ marginTop: space.lg }}>
        <GBText variant="body" tone="brand">
          Go home
        </GBText>
      </Link>
    </View>
  );
}
