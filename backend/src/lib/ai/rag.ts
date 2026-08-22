import crypto from "node:crypto";
import { query, queryOne, redis } from "../../db";
import { embed, aiConfigured, EMBED_MODEL } from "./client";

/**
 * Retrieval over the knowledge base.
 *
 * Two layers of cache in front of the embedding call, because an embedding is
 * a paid API request and the same handful of questions get asked constantly:
 * Redis (fast, optional, short TTL) in front of Postgres (durable, permanent).
 * A cache miss on both is the only path that spends money.
 */

const REDIS_TTL_SECONDS = 300;

export type KnowledgeHit = {
  id: string;
  title: string;
  content: string;
  category: string;
  subcategory: string | null;
  tags: string[];
  source_url: string | null;
  similarity: number;
};

export type RagResult = {
  results: KnowledgeHit[];
  /** How the results were found. The client shows verified sources differently. */
  method: "vector" | "text" | "text_fallback" | "none";
};

function hashOf(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export async function getEmbedding(text: string): Promise<number[]> {
  const hash = hashOf(text);

  if (redis) {
    try {
      const cached = await redis.get(`embed:${hash}`);
      if (cached) return JSON.parse(cached) as number[];
    } catch {
      /* Redis is optional; a cache read failure is not an error */
    }
  }

  const cached = await queryOne<{ embedding: string }>(
    `SELECT embedding::text FROM embedding_cache WHERE input_hash = $1`,
    [hash],
  );
  if (cached?.embedding) {
    if (redis) void redis.setex(`embed:${hash}`, REDIS_TTL_SECONDS, cached.embedding).catch(() => {});
    return JSON.parse(cached.embedding) as number[];
  }

  const embedding = await embed(text);
  const serialised = JSON.stringify(embedding);

  await query(
    `INSERT INTO embedding_cache (input_hash, input_text, embedding, model)
     VALUES ($1, $2, $3::vector, $4)
     ON CONFLICT (input_hash) DO NOTHING`,
    [hash, text, serialised, EMBED_MODEL],
  ).catch(() => {
    /* the cache is an optimisation; failing to write it must not fail the search */
  });

  if (redis) void redis.setex(`embed:${hash}`, REDIS_TTL_SECONDS, serialised).catch(() => {});

  return embedding;
}

/**
 * Full-text search over the knowledge base.
 *
 * Used both when there is no API key at all and when the embedding call fails.
 * Worse than vector search, and much better than answering with no grounding —
 * an ungrounded answer about a visa fee is the failure mode this whole
 * retrieval layer exists to prevent.
 */
async function textSearch(queryText: string, category: string | undefined, limit: number) {
  const params: unknown[] = [queryText];
  let categoryClause = "";
  if (category) {
    params.push(category);
    categoryClause = `AND category = $${params.length}`;
  }
  params.push(limit);
  const limitPlaceholder = `$${params.length}`;

  return query<KnowledgeHit>(
    `SELECT id, title, content, category, subcategory, tags, source_url,
            ts_rank(to_tsvector('english', title || ' ' || content),
                    plainto_tsquery('english', $1)) AS similarity
       FROM knowledge_base
      WHERE is_active = true
        AND to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', $1)
        ${categoryClause}
      ORDER BY similarity DESC
      LIMIT ${limitPlaceholder}`,
    params,
  );
}

export async function searchKnowledge(opts: {
  query: string;
  category?: string;
  limit?: number;
  minScore?: number;
}): Promise<RagResult> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 50);
  const minScore = opts.minScore ?? 0.5;

  if (!aiConfigured) {
    return { results: await textSearch(opts.query, opts.category, limit), method: "text" };
  }

  let embedding: number[];
  try {
    embedding = await getEmbedding(opts.query);
  } catch (err) {
    console.warn("embedding failed, falling back to text search:", (err as Error).message);
    return { results: await textSearch(opts.query, opts.category, limit), method: "text_fallback" };
  }

  const vector = `[${embedding.join(",")}]`;
  const params: unknown[] = [vector, minScore];
  let categoryClause = "";
  if (opts.category) {
    params.push(opts.category);
    categoryClause = `AND category = $${params.length}`;
  }
  params.push(limit);
  const limitPlaceholder = `$${params.length}`;

  const results = await query<KnowledgeHit>(
    `SELECT id, title, content, category, subcategory, tags, source_url,
            1 - (embedding <=> $1::vector) AS similarity
       FROM knowledge_base
      WHERE is_active = true
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> $1::vector) >= $2
        ${categoryClause}
      ORDER BY similarity DESC
      LIMIT ${limitPlaceholder}`,
    params,
  );

  return { results, method: "vector" };
}
