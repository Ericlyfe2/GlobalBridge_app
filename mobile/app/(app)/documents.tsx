import React, { useCallback, useEffect, useState } from "react";
import { View, FlatList, RefreshControl, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, Button, Skeleton, EmptyState, ErrorState, ProgressBar } from "@/src/components/ui";
import {
  fetchDocuments,
  fetchUploadStatus,
  deleteDocument,
  type UserDocument,
} from "@/src/api/endpoints";

/**
 * Documents.
 *
 * ── The status vocabulary is the server's, not this screen's ──────────────
 * `pending` / `ready` / `rejected` come off the row, and the labels below map
 * them to the words the brief specifies. Nothing here infers a status from
 * something else — an inferred "Valid" on a document the server never
 * validated is exactly the kind of false reassurance this product cannot
 * afford.
 *
 * ── No thumbnails are prefetched ──────────────────────────────────────────
 * Every document read is a separate short-lived signed URL, issued only after
 * the server checks who is asking. Fetching one per row on mount would mean
 * minting a batch of live credentials for someone's passport scan just to
 * render a list, so rows show type and status, and the URL is requested when a
 * document is actually opened.
 */

const STATUS: Record<
  UserDocument["status"],
  { label: string; tone: "success" | "info" | "danger" | "neutral"; glyph: string }
> = {
  ready: { label: "Uploaded", tone: "success", glyph: "✓" },
  pending: { label: "Processing", tone: "info", glyph: "…" },
  rejected: { label: "Needs review", tone: "danger", glyph: "!" },
};

const TYPE_LABELS: Record<string, string> = {
  passport: "Passport",
  national_id: "National ID",
  visa: "Visa",
  bank_statement: "Bank statement",
  proof_of_funds: "Proof of funds",
  transcript: "Academic transcript",
  certificate: "Certificate",
  acceptance_letter: "Admission letter",
  study_permit: "Study permit",
  insurance: "Insurance",
  accommodation: "Accommodation",
  employment: "Employment",
  other: "Other",
};

export default function DocumentsScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [docs, setDocs] = useState<UserDocument[]>([]);
  const [quota, setQuota] = useState<{ used: number; total: number; available: boolean } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [page, status] = await Promise.all([
        fetchDocuments({ limit: 50 }),
        fetchUploadStatus().catch(() => null),
      ]);
      setDocs(page.items);
      if (status) {
        setQuota({
          used: status.used_bytes,
          total: status.quota_bytes,
          available: status.available,
        });
      }
      setState("ready");
    } catch {
      setState("error");
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = (doc: UserDocument) => {
    Alert.alert(
      "Delete this document?",
      `${TYPE_LABELS[doc.type] ?? doc.type} will be removed from your account and from storage. This cannot be undone.`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            // Optimistic: the row goes immediately and comes back if the
            // server refuses, rather than leaving the user tapping a button
            // that appears to do nothing on a slow connection.
            const previous = docs;
            setDocs((prev) => prev.filter((d) => d.id !== doc.id));
            try {
              await deleteDocument(doc.id);
            } catch {
              setDocs(previous);
              Alert.alert("Not deleted", "We could not remove that just now. Please try again.");
            }
          },
        },
      ],
    );
  };

  if (state === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg, paddingTop: insets.top + space.md, gap: space.md }}>
        <Skeleton height={30} width="50%" />
        <Skeleton height={80} />
        <Skeleton height={80} />
        <Skeleton height={80} />
      </View>
    );
  }

  if (state === "error") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: space.xl }}>
        <ErrorState onRetry={() => void load()} />
      </View>
    );
  }

  const uploadsOff = quota && !quota.available;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={{ padding: space.lg, gap: space.sm }}>
        <GBText variant="title">Documents</GBText>
        {/*
          Not decoration. Documents are served through short-lived signed URLs
          and nothing is cached on the device, and the user is told so — this
          is the screen where they are handing over a passport scan.
        */}
        <GBText variant="small" tone="subtle">
          Stored encrypted. Opened through single-use links, never cached on
          this phone, and location data is stripped from every photo.
        </GBText>

        {quota ? (
          <View style={{ gap: 4, marginTop: space.xs }}>
            <ProgressBar
              percent={(quota.used / quota.total) * 100}
              label="Storage used"
              color={colors.ink5}
            />
            <GBText variant="small" tone="subtle">
              {formatBytes(quota.used)} of {formatBytes(quota.total)} used
            </GBText>
          </View>
        ) : null}

        <Button
          label="Add a document"
          onPress={() => router.push("/scan")}
          unavailableReason={uploadsOff ? "Uploads are unavailable on this server right now." : undefined}
          style={{ marginTop: space.xs }}
        />
      </View>

      <FlatList
        data={docs}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.clay} />
        }
        ListEmptyComponent={
          <EmptyState
            title="No documents yet"
            body="Your passport, admission letter and proof of funds all live here. Adding one takes a photo."
            action={{ label: "Add your first", onPress: () => router.push("/scan") }}
          />
        }
        renderItem={({ item }) => {
          const status = STATUS[item.status];
          return (
            <Card
              onPress={() => router.push(`/scan?documentId=${item.id}` as never)}
              style={{ paddingVertical: space.md }}
              accessibilityLabel={`${TYPE_LABELS[item.type] ?? item.type}, ${status.label}`}
            >
              <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <GBText variant="label">{TYPE_LABELS[item.type] ?? item.type}</GBText>
                  <GBText variant="small" tone="subtle">
                    {item.original_filename ?? "Untitled"}
                    {item.size_bytes ? ` · ${formatBytes(Number(item.size_bytes))}` : ""}
                  </GBText>
                  {item.status === "rejected" && item.rejected_reason ? (
                    <GBText variant="small" tone="danger">
                      {item.rejected_reason}
                    </GBText>
                  ) : null}
                </View>
                <View style={{ gap: 6, alignItems: "flex-end" }}>
                  <Badge label={status.label} tone={status.tone} glyph={status.glyph} />
                  {item.verified ? <Badge label="Verified" tone="success" glyph="✓" /> : null}
                </View>
              </View>

              <Button
                label="Delete"
                variant="ghost"
                onPress={() => confirmDelete(item)}
                style={{ alignSelf: "flex-start", marginTop: space.xs, paddingHorizontal: 0 }}
              />
            </Card>
          );
        }}
      />
    </View>
  );
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
