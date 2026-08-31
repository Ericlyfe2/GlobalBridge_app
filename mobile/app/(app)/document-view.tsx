import React, { useCallback, useEffect, useState } from "react";
import { View, Image, ActivityIndicator, Pressable, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Button, ErrorState } from "@/src/components/ui";
import { fetchDocumentUrl } from "@/src/api/endpoints";
import { MIN_TOUCH } from "@/src/theme/tokens";

/**
 * One document, viewed.
 *
 * The list screen deliberately prefetches nothing — every read here is a
 * fresh, short-lived signed URL, minted only once someone actually opens this
 * specific document (documents.tsx's own note explains why). That is also why
 * this screen re-fetches on "Try again" rather than caching the first URL: a
 * link that expired five minutes ago is not a link worth remembering.
 *
 * A PDF or a scan saved as `application/octet-stream` cannot render inline in
 * an `Image`, so those hand off to the OS viewer via `Linking` instead of
 * failing silently.
 */
export default function DocumentViewScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; type?: string; mime?: string }>();

  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "image-error">("loading");

  const isImage = (params.mime ?? "").startsWith("image/");

  const load = useCallback(async () => {
    if (!params.id) return;
    setState("loading");
    try {
      const res = await fetchDocumentUrl(params.id);
      setUrl(res.url);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!params.id) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: space.xl }}>
        <ErrorState title="Document not found" body="That link is not valid." onRetry={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingHorizontal: space.lg,
          paddingBottom: space.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, justifyContent: "center" }}
        >
          <GBText variant="body" tone="brand">
            ‹ Back
          </GBText>
        </Pressable>
        <GBText variant="heading" style={{ flex: 1 }} numberOfLines={1}>
          {params.type ?? "Document"}
        </GBText>
      </View>

      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg }}>
        {state === "loading" ? (
          <ActivityIndicator size="large" color={colors.clay} />
        ) : state === "error" ? (
          <ErrorState
            title="Could not open this document"
            body="The link may have expired. Try again."
            onRetry={() => void load()}
          />
        ) : !isImage ? (
          <View style={{ alignItems: "center", gap: space.md }}>
            <GBText variant="body" tone="muted" style={{ textAlign: "center" }}>
              This file type cannot be previewed in the app.
            </GBText>
            <Button label="Open document" onPress={() => url && void Linking.openURL(url)} />
          </View>
        ) : state === "image-error" ? (
          <View style={{ alignItems: "center", gap: space.md }}>
            <GBText variant="body" tone="muted" style={{ textAlign: "center" }}>
              This link expired before the image loaded.
            </GBText>
            <Button label="Try again" onPress={() => void load()} />
          </View>
        ) : (
          <Image
            source={{ uri: url! }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="contain"
            onError={() => setState("image-error")}
            accessibilityLabel={params.type ?? "Document image"}
          />
        )}
      </View>
    </View>
  );
}
