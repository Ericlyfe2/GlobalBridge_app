import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../../db";
import { requireAuth } from "../../middleware/auth";
import { aiGuard, tooLarge, totalChars } from "../../lib/ai/guard";
import { getAiConfig } from "../../lib/ai/config";
import { chatCompletion, aiConfigured } from "../../lib/ai/client";
import { CHAT_SYSTEM, LANG_NAMES } from "../../lib/ai/prompts";
import { recordUsage } from "../../lib/ai/usage";
import { searchKnowledge, type KnowledgeHit } from "../../lib/ai/rag";
import { normalizeLocale } from "../../lib/i18n";

export const chatRouter = Router();

/** Ceiling on prompt text per request. max_tokens only caps the reply. */
const MAX_INPUT_CHARS = 24_000;
/** Guards against a huge array of tiny messages slipping under the char cap. */
const MAX_MESSAGES = 40;
/** How much prior conversation is replayed into the context window. */
const HISTORY_LIMIT = 20;

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        // Deliberately looser than MAX_INPUT_CHARS. The aggregate check below
        // is the real ceiling and answers 413 naming the limit, which tells the
        // user how much to cut; a per-field Zod cap set to the same number
        // would fire first and give them a generic validation error instead.
        content: z.string().min(1).max(MAX_INPUT_CHARS * 2),
      }),
    )
    .min(1, "messages[] required")
    .max(MAX_MESSAGES * 2),
  lang: z.string().max(10).optional(),
  conversation_id: z.string().uuid().optional(),
});

type Source = { title: string; url: string; confidence: "verified" | "knowledge_base" | "web" };

/**
 * Build the source list shown under an answer.
 *
 * Confidence is not a model self-report — it is where the URL came from. A link
 * the model produced from its own weights is "web" and is presented as
 * something to check; a link that came out of the curated knowledge base is
 * "knowledge_base". The distinction is the whole point of showing sources at
 * all: this audience acts on these links.
 */
function buildSources(text: string, hits: KnowledgeHit[]): Source[] {
  const sources: Source[] = [];
  const seen = new Set<string>();

  const urls = text.match(/https?:\/\/[^\s)\]]+/g) ?? [];
  for (const url of urls.slice(0, 5)) {
    if (seen.has(url)) continue;
    seen.add(url);
    let title = url;
    try {
      title = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* keep the raw string as the label */
    }
    sources.push({
      title,
      url,
      confidence: hits.some((h) => h.source_url === url) ? "verified" : "web",
    });
  }

  for (const hit of hits) {
    if (hit.source_url && !seen.has(hit.source_url)) {
      seen.add(hit.source_url);
      sources.push({ title: hit.title, url: hit.source_url, confidence: "knowledge_base" });
    }
  }

  return sources;
}

/** Conversation history, scoped to the caller. */
async function loadHistory(conversationId: string, userId: string) {
  const owned = await queryOne<{ id: string }>(
    `SELECT id FROM ai_conversations WHERE id = $1 AND user_id = $2`,
    [conversationId, userId],
  );
  if (!owned) return null;

  // Newest N, then re-ordered oldest-first for the model. Taking the *oldest*
  // 20 would replay the start of a long conversation and drop what was just
  // said, which reads as the assistant losing the thread.
  const rows = await query<{ role: "user" | "assistant"; content: string }>(
    `SELECT role, content FROM ai_messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [conversationId, HISTORY_LIMIT],
  );
  return rows.reverse();
}

chatRouter.post("/", requireAuth, aiGuard("chat"), async (req, res, next) => {
  try {
    const body = bodySchema.parse(req.body);

    if (body.messages.length > MAX_MESSAGES) {
      return res.status(400).json({
        error: `Too many messages in one request (max ${MAX_MESSAGES}).`,
        code: "chat/too-many-messages",
      });
    }
    if (totalChars(body.messages.map((m) => m.content)) > MAX_INPUT_CHARS) {
      return tooLarge(res, MAX_INPUT_CHARS);
    }

    const config = await getAiConfig();
    const locale = normalizeLocale(body.lang);
    const userId = req.user!.sub;

    const unavailable = (message: string) => {
      res.set("Cache-Control", "no-store");
      return res.json({ reply: message, sources: [], degraded: true, lang: locale });
    };

    if (!config.ai_chat_enabled) {
      return unavailable(
        "The AI assistant has been turned off by an admin. You can still browse verified " +
          "opportunities, check your document checklist, or ask in the community forums.",
      );
    }
    if (!aiConfigured) {
      return unavailable(
        "The AI assistant is not configured yet. You can still browse verified opportunities, " +
          "check your document checklist, or ask in the community forums.",
      );
    }

    // ── Retrieval ─────────────────────────────────────────────────────────
    // In the previous architecture this was an HTTP POST to /api/rag/search on
    // another service. It is a function call now.
    const lastUserMessage = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const rag = lastUserMessage
      ? await searchKnowledge({ query: lastUserMessage, limit: 5, minScore: 0.5 })
      : { results: [] as KnowledgeHit[], method: "none" as const };

    // ── Caller context ────────────────────────────────────────────────────
    const profile = await queryOne<{
      full_name: string;
      role: string;
      country_of_origin: string | null;
      country_of_residence: string | null;
      verification_status: string;
    }>(
      `SELECT full_name, role, country_of_origin, country_of_residence, verification_status
         FROM users WHERE id = $1`,
      [userId],
    );

    // ── Conversation ──────────────────────────────────────────────────────
    let conversationId = body.conversation_id ?? null;
    let history: { role: "user" | "assistant"; content: string }[] = [];

    if (conversationId) {
      const loaded = await loadHistory(conversationId, userId);
      if (loaded === null) {
        // Someone else's conversation id, or one that does not exist. Same 404
        // for both: a 403 would confirm the id belongs to a real conversation.
        return res.status(404).json({ error: "Conversation not found" });
      }
      history = loaded;
    } else {
      const created = await queryOne<{ id: string }>(
        `INSERT INTO ai_conversations (user_id, title, origin_country, destination_country)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          userId,
          lastUserMessage.slice(0, 60) || "New conversation",
          profile?.country_of_origin ?? null,
          profile?.country_of_residence ?? null,
        ],
      );
      conversationId = created?.id ?? null;
    }

    // ── Prompt assembly ───────────────────────────────────────────────────
    const ragBlock = rag.results.length
      ? `\n\n## Retrieved knowledge\nUse these entries from GlobalBridge's curated knowledge base where they apply. If they do not answer the question, say so rather than stretching them.\n` +
        rag.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`).join("\n\n")
      : "";

    const userBlock = profile
      ? `\n\n## Who you are talking to\n- Name: ${profile.full_name}\n- Role: ${profile.role}` +
        (profile.country_of_origin ? `\n- From: ${profile.country_of_origin}` : "") +
        (profile.country_of_residence ? `\n- Currently in: ${profile.country_of_residence}` : "")
      : "";

    const langBlock =
      locale !== "en"
        ? `\n\n## Language\nRespond entirely in ${LANG_NAMES[locale]}. Every sentence. Only URLs, brand names and untranslatable terms stay in English.`
        : "";

    const adminBlock = config.ai_system_prompt.trim()
      ? `\n\n## Additional guidance from the platform team\n${config.ai_system_prompt.trim()}`
      : "";

    // Admin guidance sits before the retrieved knowledge and the user block, so
    // it can shape tone and emphasis but cannot be positioned as the last word
    // over the safety rules baked into CHAT_SYSTEM.
    const system = CHAT_SYSTEM + adminBlock + ragBlock + userBlock + langBlock;

    try {
      const completion = await chatCompletion({
        model: config.ai_model,
        maxTokens: 1024,
        temperature: config.ai_temperature,
        messages: [
          { role: "system", content: system },
          ...history,
          ...body.messages,
        ],
      });

      await recordUsage({
        userId,
        feature: "chat",
        model: config.ai_model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        responseTimeMs: completion.responseTimeMs,
      });

      const reply = completion.text || "I could not generate a response. Try rephrasing that.";
      const sources = buildSources(reply, rag.results);

      // ── Persist ─────────────────────────────────────────────────────────
      // Best-effort: the answer has already been paid for and is going back to
      // the user either way. Losing the transcript is worse than not losing it,
      // but far better than turning a good answer into an error.
      let messageId: string | null = null;
      if (conversationId) {
        try {
          const userMessage = [...body.messages].reverse().find((m) => m.role === "user");
          if (userMessage) {
            await query(
              `INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
              [conversationId, userMessage.content],
            );
          }
          const inserted = await queryOne<{ id: string }>(
            `INSERT INTO ai_messages (conversation_id, role, content, sources)
             VALUES ($1, 'assistant', $2, $3) RETURNING id`,
            [conversationId, reply, JSON.stringify(sources)],
          );
          messageId = inserted?.id ?? null;
          await query(
            `UPDATE ai_conversations
                SET message_count = message_count + 2, updated_at = NOW()
              WHERE id = $1`,
            [conversationId],
          );
        } catch (persistErr) {
          console.error("[ai/chat] failed to persist transcript:", (persistErr as Error).message);
        }
      }

      res.set("Cache-Control", "no-store");
      return res.json({
        reply,
        sources,
        lang: locale,
        conversation_id: conversationId,
        message_id: messageId,
        retrieval: rag.method,
        usage: {
          input_tokens: completion.inputTokens,
          output_tokens: completion.outputTokens,
          response_time_ms: completion.responseTimeMs,
        },
      });
    } catch (err) {
      await recordUsage({
        userId,
        feature: "chat",
        model: config.ai_model,
        error: (err as Error).message.slice(0, 500),
      });
      console.error("[ai/chat]", (err as Error).message);
      res.set("Cache-Control", "no-store");
      return res.json({
        reply:
          "The assistant is temporarily unavailable — our AI provider is having trouble. " +
          "Meanwhile you can browse verified opportunities, check housing listings, or post in the community. Please try again shortly.",
        sources: [],
        degraded: true,
        conversation_id: conversationId,
        lang: locale,
      });
    }
  } catch (err) {
    next(err);
  }
});
