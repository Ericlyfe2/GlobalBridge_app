import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
  Modal,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, Button, EmptyState, Skeleton } from "@/src/components/ui";
import { AmbientBackground } from "@/src/components/AmbientBackground";
import {
  sendChat,
  fetchAiConversations,
  fetchAiConversation,
  deleteAiConversation,
  renameAiConversation,
  submitAiFeedback,
  type AiSource,
  type AiConversation,
} from "@/src/api/endpoints";
import { MIN_TOUCH } from "@/src/theme/tokens";

/**
 * The AI Visa Assistant.
 *
 * ── Sources are the feature ───────────────────────────────────────────────
 * §43 and the design's own note: every factual answer surfaces what it was
 * based on, and the badge says *where the link came from* rather than how
 * confident the model claims to be. `knowledge_base` is curated and checked;
 * `web` is the model's own recall and is labelled as something to verify.
 *
 * That distinction is not decoration. This audience acts on these links — a
 * wrong fee is money they do not have, a wrong deadline is a missed intake
 * year — and a model that cites confidently is indistinguishable from one that
 * cites correctly unless the provenance is shown.
 *
 * ── Degraded is stated, never hidden ──────────────────────────────────────
 * When the server answers `degraded`, the reply is real but the model did not
 * run. The banner says so rather than letting a fallback sentence pass as
 * guidance.
 *
 * ── History, and why a message needs an id before it can be rated ─────────
 * Feedback is scored per assistant message, not per conversation, so a thumbs
 * vote is only possible once the server has told the client which row it just
 * wrote (`message_id` on the chat response). A message loaded back out of
 * history carries its real id already; a message that just streamed in from
 * `sendChat` does not get one until the reply lands.
 */

type Turn = {
  role: "user" | "assistant";
  content: string;
  sources?: AiSource[];
  degraded?: boolean;
  messageId?: string | null;
  rating?: number;
};

export default function AssistantScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scroller = useRef<ScrollView>(null);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;

    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setDraft("");
    setSending(true);
    setError(null);

    try {
      const reply = await sendChat({
        messages: next.map((t) => ({ role: t.role, content: t.content })),
        conversation_id: conversationId,
      });
      setConversationId(reply.conversation_id ?? undefined);
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: reply.reply,
          sources: reply.sources,
          degraded: reply.degraded,
          messageId: reply.message_id,
        },
      ]);
    } catch (err) {
      const message = (err as { message?: string }).message;
      const code = (err as { code?: string }).code;
      setError(
        code === "ai/daily-ceiling"
          ? "You have reached today's AI limit. It resets at midnight UTC — everything else in the app still works."
          : code === "ai/rate-limited"
            ? "That was quick. Give it a moment and try again."
            : message || "The assistant could not answer just now.",
      );
      // The user's own message stays on screen; retyping it would be the
      // second frustration on top of the failure.
    } finally {
      setSending(false);
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
    }
  }, [draft, sending, turns, conversationId]);

  const startNew = useCallback(() => {
    setTurns([]);
    setConversationId(undefined);
    setError(null);
    setDraft("");
  }, []);

  const resume = useCallback(async (conversation: AiConversation) => {
    setHistoryOpen(false);
    setError(null);
    try {
      const { messages } = await fetchAiConversation(conversation.id);
      setTurns(
        messages.map((m) => ({
          role: m.role,
          content: m.content,
          sources: m.sources ?? undefined,
          messageId: m.id,
        })),
      );
      setConversationId(conversation.id);
    } catch {
      setError("Could not load that conversation.");
    }
  }, []);

  const rate = useCallback(async (turn: Turn, index: number, rating: number) => {
    if (!turn.messageId) return;
    setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, rating } : t)));
    try {
      await submitAiFeedback({ message_id: turn.messageId, rating });
    } catch {
      setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, rating: undefined } : t)));
    }
  }, []);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.bottom + 62}
    >
      <AmbientBackground />
      <View
        style={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg,
          flexDirection: "row",
          alignItems: "flex-start",
          gap: space.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <GBText variant="title">AI Visa Assistant</GBText>
          <GBText variant="small" tone="subtle" style={{ marginTop: 2 }}>
            Guides and cites its sources. Not a government service, and not legal advice.
          </GBText>
        </View>
        <Pressable
          onPress={() => setHistoryOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Past conversations"
          style={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="time-outline" size={22} color={colors.ink6} />
        </Pressable>
        {turns.length > 0 ? (
          <Pressable
            onPress={startNew}
            accessibilityRole="button"
            accessibilityLabel="New conversation"
            style={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="add-circle-outline" size={22} color={colors.ink6} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        keyboardShouldPersistTaps="handled"
      >
        {turns.length === 0 ? (
          <Starters onPick={(q) => setDraft(q)} />
        ) : (
          turns.map((turn, i) =>
            turn.role === "user" ? (
              <View
                key={i}
                style={{
                  alignSelf: "flex-end",
                  maxWidth: "85%",
                  backgroundColor: colors.clay,
                  borderRadius: radius.lg,
                  borderBottomRightRadius: 4,
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm,
                }}
              >
                <GBText variant="body" style={{ color: "#ffffff" }}>
                  {turn.content}
                </GBText>
              </View>
            ) : (
              <View key={i} style={{ gap: space.sm }}>
                <Card style={{ paddingVertical: space.md }}>
                  {turn.degraded ? (
                    <View style={{ marginBottom: space.sm }}>
                      <Badge label="Limited answer" tone="warning" glyph="!" />
                      <GBText variant="small" tone="muted" style={{ marginTop: 4 }}>
                        The assistant could not run fully. Treat this as general
                        information and check an official source.
                      </GBText>
                    </View>
                  ) : null}
                  <GBText variant="body">{turn.content}</GBText>
                </Card>
                {turn.sources && turn.sources.length > 0 ? (
                  <View style={{ gap: 6 }}>
                    <GBText variant="tag" tone="subtle">
                      Sources
                    </GBText>
                    {turn.sources.map((source, si) => (
                      <SourceRow key={si} source={source} />
                    ))}
                  </View>
                ) : null}
                {turn.messageId ? (
                  <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
                    <Pressable
                      onPress={() => void rate(turn, i, 5)}
                      accessibilityRole="button"
                      accessibilityLabel="Helpful"
                      hitSlop={8}
                    >
                      <Ionicons
                        name={turn.rating === 5 ? "thumbs-up" : "thumbs-up-outline"}
                        size={18}
                        color={turn.rating === 5 ? colors.clay : colors.ink5}
                      />
                    </Pressable>
                    <Pressable
                      onPress={() => void rate(turn, i, 1)}
                      accessibilityRole="button"
                      accessibilityLabel="Not helpful"
                      hitSlop={8}
                    >
                      <Ionicons
                        name={turn.rating === 1 ? "thumbs-down" : "thumbs-down-outline"}
                        size={18}
                        color={turn.rating === 1 ? colors.danger : colors.ink5}
                      />
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ),
          )
        )}

        {sending ? (
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <ActivityIndicator color={colors.clay} />
            <GBText variant="small" tone="subtle">
              Checking sources…
            </GBText>
          </View>
        ) : null}

        {error ? (
          <Card accent={colors.amber}>
            <GBText variant="small" tone="muted">
              {error}
            </GBText>
          </Card>
        ) : null}
      </ScrollView>

      <View
        style={{
          flexDirection: "row",
          gap: space.sm,
          padding: space.md,
          paddingBottom: space.md,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask about visas, funding, housing…"
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
        <Button label="Send" onPress={() => void send()} disabled={!draft.trim()} loading={sending} />
      </View>

      <HistorySheet
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onPick={resume}
        activeId={conversationId}
      />
    </KeyboardAvoidingView>
  );
}

/**
 * Past conversations.
 *
 * A bottom sheet rather than a separate route: it is a jump list over the
 * current screen, not a destination of its own, and closing it should feel
 * like dismissing a picker rather than navigating back.
 */
function HistorySheet({
  visible,
  onClose,
  onPick,
  activeId,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (conversation: AiConversation) => void;
  activeId?: string;
}) {
  const { colors, space, radius } = useTheme();
  const [items, setItems] = useState<AiConversation[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const page = await fetchAiConversations({ limit: 50 });
      setItems(page.items);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const remove = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((c) => c.id !== id));
    try {
      await deleteAiConversation(id);
    } catch {
      void load();
    }
  }, [load]);

  const [renaming, setRenaming] = useState<AiConversation | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const submitRename = useCallback(async () => {
    const target = renaming;
    const title = renameDraft.trim();
    if (!target || !title) return;
    setRenaming(null);
    setItems((prev) => prev.map((c) => (c.id === target.id ? { ...c, title } : c)));
    try {
      await renameAiConversation(target.id, title);
    } catch {
      void load();
    }
  }, [renaming, renameDraft, load]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.bg,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            maxHeight: "75%",
            padding: space.lg,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.md }}>
            <GBText variant="heading" style={{ flex: 1 }}>
              Past conversations
            </GBText>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.ink6} />
            </Pressable>
          </View>

          {state === "loading" ? (
            <View style={{ gap: space.sm }}>
              <Skeleton height={64} />
              <Skeleton height={64} />
            </View>
          ) : state === "error" ? (
            <GBText variant="small" tone="muted">
              Could not load your conversations.
            </GBText>
          ) : items.length === 0 ? (
            <EmptyState title="No conversations yet" body="Questions you ask the assistant will be saved here." />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ gap: space.sm, paddingBottom: space.lg }}
              renderItem={({ item }) => (
                <Card
                  onPress={() => onPick(item)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                    borderColor: item.id === activeId ? colors.clay : colors.border,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <GBText variant="label" numberOfLines={1}>
                      {item.title}
                    </GBText>
                    <GBText variant="small" tone="subtle" style={{ marginTop: 2 }}>
                      {item.message_count} messages · {new Date(item.updated_at).toLocaleDateString()}
                    </GBText>
                  </View>
                  <Pressable
                    onPress={() => {
                      setRenameDraft(item.title);
                      setRenaming(item);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${item.title}`}
                    hitSlop={8}
                    style={{ marginRight: space.md }}
                  >
                    <Ionicons name="pencil-outline" size={18} color={colors.ink5} />
                  </Pressable>
                  <Pressable
                    onPress={() => void remove(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${item.title}`}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.ink5} />
                  </Pressable>
                </Card>
              )}
            />
          )}
        </Pressable>
      </Pressable>

      <Modal visible={renaming !== null} animationType="fade" transparent onRequestClose={() => setRenaming(null)}>
        <Pressable
          onPress={() => setRenaming(null)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: space.xl }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{ backgroundColor: colors.bg, borderRadius: radius.lg, padding: space.lg, gap: space.md }}
          >
            <GBText variant="heading">Rename conversation</GBText>
            <TextInput
              value={renameDraft}
              onChangeText={setRenameDraft}
              autoFocus
              maxLength={255}
              placeholder="Conversation title"
              placeholderTextColor={colors.ink5}
              style={{
                minHeight: MIN_TOUCH,
                borderRadius: radius.md,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: space.md,
                color: colors.ink,
                fontSize: 15,
              }}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.md }}>
              <Pressable onPress={() => setRenaming(null)} accessibilityRole="button">
                <GBText variant="body" tone="muted">
                  Cancel
                </GBText>
              </Pressable>
              <Pressable onPress={() => void submitRename()} accessibilityRole="button" disabled={!renameDraft.trim()}>
                <GBText variant="body" tone="brand" style={{ opacity: renameDraft.trim() ? 1 : 0.5 }}>
                  Save
                </GBText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}

/**
 * Provenance badge.
 *
 * `verified` means the URL the model cited is one the knowledge base also
 * holds — the strongest signal available. `web` means the model produced it
 * unaided, and the label says "check this" rather than pretending otherwise.
 */
function SourceRow({ source }: { source: AiSource }) {
  const { space } = useTheme();

  const tone =
    source.confidence === "knowledge_base"
      ? ("success" as const)
      : source.confidence === "verified"
        ? ("brand" as const)
        : ("neutral" as const);

  const label =
    source.confidence === "knowledge_base"
      ? "Official"
      : source.confidence === "verified"
        ? "Cross-checked"
        : "Unverified";

  return (
    <Pressable
      onPress={() => void Linking.openURL(source.url)}
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${source.title}`}
      style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
    >
      <Badge label={label} tone={tone} glyph={source.confidence === "web" ? "?" : "✓"} />
      <GBText variant="small" tone="brand" style={{ flex: 1 }} numberOfLines={1}>
        {source.title}
      </GBText>
    </Pressable>
  );
}

function Starters({ onPick }: { onPick: (q: string) => void }) {
  const { space } = useTheme();
  const questions = [
    "How much proof of funds do I need for a Canadian study permit?",
    "What is a GIC and do I need one?",
    "My passport expires during my course — is that a problem?",
    "How long do biometrics take after I apply?",
  ];

  return (
    <View style={{ gap: space.sm }}>
      <GBText variant="body" tone="muted">
        Ask anything about moving abroad. Answers cite where they came from.
      </GBText>
      {questions.map((q) => (
        <Card key={q} onPress={() => onPick(q)} style={{ paddingVertical: space.md }}>
          <GBText variant="body">{q}</GBText>
        </Card>
      ))}
    </View>
  );
}
