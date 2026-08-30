import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Button, Skeleton, ErrorState, Badge } from "@/src/components/ui";
import { fetchMessages, sendMessage, type Message } from "@/src/api/endpoints";
import { MIN_TOUCH } from "@/src/theme/tokens";
import { useAuth } from "@/src/contexts/AuthContext";

/**
 * One conversation.
 *
 * ── Optimistic send, and the idempotency key that makes it safe ───────────
 * The message appears immediately with a "sending" state. That is not just
 * polish: on a slow connection the alternative is a keyboard that empties two
 * seconds after you press send, which reads as the message having been lost.
 *
 * Every send carries a client-generated id. A retry — whether the user's or the
 * offline queue's on reconnect — reuses it, and the server deduplicates rather
 * than writing a second copy. Without it, the honest thing to do after a
 * timeout would be nothing, because resending risks a double-send and the
 * client cannot tell a timeout from a slow success.
 *
 * A failed message stays on screen, marked, with a retry. Dropping it would
 * lose text the user wrote.
 */

type Pending = Message & { _pending?: true; _failed?: true; _clientId?: string };

export default function ThreadScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const auth = useAuth();

  const conversationId = params.id;
  const me = auth.status === "signed-in" ? auth.profile.id : null;

  const [messages, setMessages] = useState<Pending[]>([]);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const listRef = useRef<FlatList<Pending>>(null);

  const load = useCallback(async () => {
    if (!conversationId) return;
    try {
      const page = await fetchMessages(conversationId, { limit: 50 });
      // The API returns newest first; an inverted list wants that order as-is.
      setMessages(page.items);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(
    async (text: string, existingClientId?: string) => {
      if (!conversationId || !text.trim() || !me) return;

      const clientId =
        existingClientId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const optimistic: Pending = {
        id: clientId,
        conversation_id: conversationId,
        sender_id: me,
        body: text,
        is_read: false,
        created_at: new Date().toISOString(),
        _pending: true,
        _clientId: clientId,
      };

      setMessages((prev) => [optimistic, ...prev.filter((m) => m._clientId !== clientId)]);
      setDraft("");

      try {
        const { message } = await sendMessage(conversationId, text, clientId);
        setMessages((prev) => [message, ...prev.filter((m) => m._clientId !== clientId)]);
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m._clientId === clientId ? { ...m, _pending: undefined, _failed: true } : m,
          ),
        );
      }
    },
    [conversationId, me],
  );

  if (!conversationId) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: space.xl }}>
        <ErrorState
          title="Conversation not found"
          body="That conversation could not be opened."
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.bottom}
    >
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
          {params.name ?? "Conversation"}
        </GBText>
      </View>

      {state === "loading" ? (
        <View style={{ padding: space.lg, gap: space.sm }}>
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </View>
      ) : state === "error" ? (
        <ErrorState onRetry={() => void load()} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          inverted
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: space.lg, gap: space.sm }}
          renderItem={({ item }) => {
            const mine = item.sender_id === me;
            return (
              <View style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
                <View
                  style={{
                    maxWidth: "82%",
                    backgroundColor: mine ? colors.clay : colors.surface,
                    borderWidth: mine ? 0 : 1,
                    borderColor: colors.border,
                    borderRadius: radius.lg,
                    borderBottomRightRadius: mine ? 4 : radius.lg,
                    borderBottomLeftRadius: mine ? radius.lg : 4,
                    paddingHorizontal: space.md,
                    paddingVertical: space.sm,
                    opacity: item._pending ? 0.6 : 1,
                  }}
                >
                  <GBText variant="body" style={mine ? { color: "#ffffff" } : undefined}>
                    {item.body}
                  </GBText>
                </View>

                {item._failed ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 4 }}>
                    <Badge label="Not sent" tone="danger" glyph="!" />
                    <Pressable
                      onPress={() => void send(item.body, item._clientId)}
                      accessibilityRole="button"
                    >
                      <GBText variant="small" tone="brand">
                        Retry
                      </GBText>
                    </Pressable>
                  </View>
                ) : (
                  <GBText variant="small" tone="subtle" style={{ marginTop: 2 }}>
                    {item._pending ? "Sending…" : formatTime(item.created_at)}
                  </GBText>
                )}
              </View>
            );
          }}
        />
      )}

      <View
        style={{
          flexDirection: "row",
          gap: space.sm,
          padding: space.md,
          paddingBottom: Math.max(space.md, insets.bottom),
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={colors.ink5}
          multiline
          accessibilityLabel="Message"
          style={{
            flex: 1,
            minHeight: MIN_TOUCH,
            maxHeight: 120,
            borderRadius: radius.md,
            backgroundColor: colors.alt,
            paddingHorizontal: space.md,
            paddingTop: 12,
            color: colors.ink,
            fontSize: 15,
          }}
        />
        <Button label="Send" onPress={() => void send(draft)} disabled={!draft.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );
}
