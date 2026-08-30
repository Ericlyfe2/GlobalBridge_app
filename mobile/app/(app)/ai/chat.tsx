/**
 * AI Chat.
 *
 * POST /ai/chat — the immigration copilot. The conversation is persisted
 * server-side and loaded on re-entry via conversation_id.
 */

import { useState, useRef, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  FlatList, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { post } from "@/src/api/client";

type ChatMessage = { role: "user" | "assistant"; content: string };

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const allMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await post<{
        reply: string;
        conversation_id: string;
        sources?: Array<{ title: string; url: string; confidence: string }>;
        degraded?: boolean;
      }>("/ai/chat", {
        messages: allMessages,
        conversation_id: conversationId,
      });

      setConversationId(res.conversation_id);
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, something went wrong. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AI Assistant</Text>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.messageList}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === "user" ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                item.role === "user" ? styles.userBubbleText : styles.assistantBubbleText,
              ]}
            >
              {item.content}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="chatbubble-ellipses" size={40} color="#374151" />
            <Text style={styles.emptyText}>
              Ask anything about visas, housing, or life abroad.
            </Text>
          </View>
        }
      />

      {/* Input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Ask a question..."
          placeholderTextColor="#6B7280"
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={4000}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!input.trim() || loading) && styles.sendButtonDisabled]}
          onPress={send}
          disabled={!input.trim() || loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="send" size={20} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12 },
  headerTitle: { fontSize: 24, fontWeight: "700", color: "#FFFFFF" },
  messageList: { padding: 20, paddingBottom: 8 },
  bubble: { maxWidth: "80%", padding: 12, borderRadius: 16, marginBottom: 8 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#3B82F6", borderBottomRightRadius: 4 },
  assistantBubble: { alignSelf: "flex-start", backgroundColor: "#1E293B", borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  userBubbleText: { color: "#FFFFFF" },
  assistantBubbleText: { color: "#E2E8F0" },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 80, gap: 12 },
  emptyText: { color: "#6B7280", fontSize: 15, textAlign: "center" },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    padding: 12, paddingBottom: 24, backgroundColor: "#0F172A",
    borderTopWidth: 1, borderTopColor: "#1E293B",
  },
  input: {
    flex: 1, backgroundColor: "#1E293B", borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    color: "#FFFFFF", fontSize: 15, maxHeight: 100,
  },
  sendButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "#3B82F6",
    justifyContent: "center", alignItems: "center",
  },
  sendButtonDisabled: { opacity: 0.4 },
});
