import React, { useCallback, useRef, useState } from "react";
import {
  View,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { GBText, Card, Badge, Button } from "@/src/components/ui";
import { sendChat, type AiSource } from "@/src/api/endpoints";
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
 */

type Turn = { role: "user" | "assistant"; content: string; sources?: AiSource[]; degraded?: boolean };

export default function AssistantScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.bottom + 62}
    >
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg }}>
        <GBText variant="title">AI Visa Assistant</GBText>
        <GBText variant="small" tone="subtle" style={{ marginTop: 2 }}>
          Guides and cites its sources. Not a government service, and not legal advice.
        </GBText>
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
    </KeyboardAvoidingView>
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
