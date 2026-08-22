/**
 * The OpenAI chat-completions client.
 *
 * Written against `fetch` rather than pulling in the vendor SDK. The SDK's
 * value is streaming helpers, retry policy and typed helpers for the whole
 * surface; this service uses one endpoint, wants its own timeout, and must not
 * inherit a retry policy that silently doubles spend on a slow request. A
 * dependency that ships an implicit retry loop is not a small dependency when
 * every call costs money.
 *
 * The key lives here and only here. It never travels to a client, and there is
 * no code path that returns it in a response.
 */

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

/** True when a key is configured at all. Every feature checks this first. */
export const aiConfigured = Boolean(API_KEY);

/**
 * Wall-clock ceiling on one completion.
 *
 * A mobile client on a slow connection is already waiting; a request that hangs
 * past this is not going to produce a useful answer before the user gives up,
 * and holding the socket open costs us a connection slot either way.
 */
const REQUEST_TIMEOUT_MS = 45_000;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
};

export type ChatResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  responseTimeMs: number;
};

export class AiUnavailableError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export async function chatCompletion(req: ChatRequest): Promise<ChatResult> {
  if (!API_KEY) throw new AiUnavailableError("OPENAI_API_KEY is not configured");

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // The body is logged, never returned: provider errors quote the request
      // back, and the request contains the user's essay or pasted message.
      throw new AiUnavailableError(
        `OpenAI responded ${res.status}: ${detail.slice(0, 300)}`,
        res.status,
      );
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      text: data.choices?.[0]?.message?.content?.trim() ?? "",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      responseTimeMs: Date.now() - started,
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new AiUnavailableError(`OpenAI request exceeded ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const EMBED_MODEL = "text-embedding-3-small";

export async function embed(text: string): Promise<number[]> {
  if (!API_KEY) throw new AiUnavailableError("OPENAI_API_KEY is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${BASE_URL}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AiUnavailableError(`Embedding API ${res.status}: ${detail.slice(0, 200)}`, res.status);
    }

    const data = (await res.json()) as { data?: { embedding: number[] }[] };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding) throw new AiUnavailableError("Embedding API returned no vector");
    return embedding;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new AiUnavailableError("Embedding request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export { EMBED_MODEL };
