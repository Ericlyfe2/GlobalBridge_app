-- Up Migration
--
-- Tables the AI surface reads and writes. Idempotent for the same reason as
-- 0001: this runs against a database the web platform already uses.

CREATE EXTENSION IF NOT EXISTS "vector";

-- ------------------------------------------------------------ conversations --
CREATE TABLE IF NOT EXISTS ai_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255),
    origin_country VARCHAR(100),
    destination_country VARCHAR(100),
    visa_type VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS message_count INT DEFAULT 0;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS topics TEXT[];
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    sources JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id, created_at ASC);

-- ------------------------------------------------------ usage and feedback --
-- The ledger is the enforcement point for the per-user daily spend ceiling as
-- well as the admin console's data source. Cost is not stored: it is derived
-- from tokens on read, so a price correction reprices history instead of
-- leaving two eras of numbers in one table.
CREATE TABLE IF NOT EXISTS ai_usage_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    feature VARCHAR(100) NOT NULL,
    model VARCHAR(100),
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    cache_hit BOOLEAN DEFAULT FALSE,
    response_time_ms INT,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_feature ON ai_usage_log(feature);
-- Serves the daily-spend query, which filters on user AND day. The
-- single-column indexes cannot serve that pair efficiently.
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user_created ON ai_usage_log(user_id, created_at);

CREATE TABLE IF NOT EXISTS ai_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID REFERENCES ai_messages(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    feedback_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_message ON ai_feedback(message_id);

-- Thumbs-up/down is a per-user judgement of one answer. Without this a client
-- retry writes a second row and the aggregate quietly double-counts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_feedback_message_user
    ON ai_feedback(message_id, user_id);

-- ------------------------------------------------------------------- RAG --
CREATE TABLE IF NOT EXISTS knowledge_base (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(500) NOT NULL UNIQUE,
    content TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    subcategory VARCHAR(100),
    tags TEXT[],
    metadata JSONB DEFAULT '{}'::jsonb,
    source_url TEXT,
    embedding vector(1536),
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_active ON knowledge_base(is_active);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_embedding
    ON knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- The text-search fallback used when there is no embedding available runs this
-- expression on every row; without the index it is a sequential scan plus a
-- to_tsvector call per row.
CREATE INDEX IF NOT EXISTS idx_knowledge_base_fts
    ON knowledge_base USING gin(to_tsvector('english', title || ' ' || content));

CREATE TABLE IF NOT EXISTS embedding_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    input_hash VARCHAR(64) UNIQUE NOT NULL,
    input_text TEXT NOT NULL,
    embedding vector(1536),
    model VARCHAR(100) DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------ admin-owned config --
CREATE TABLE IF NOT EXISTS platform_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seeded only where absent, so an admin's existing choices are never
-- overwritten by a migration.
--
-- ai_model is seeded to an OpenAI model on purpose. The web platform's seed
-- set it to "claude-haiku-4-5" while the calling code speaks the OpenAI
-- chat-completions API, so every request 400s and silently lands in the mock
-- fallback -- the AI appears to work while never actually running. lib/ai/
-- config.ts additionally refuses a model whose provider does not match the
-- configured client, rather than trusting this row.
INSERT INTO platform_settings (key, value) VALUES
    ('ai_chat_enabled', 'true'),
    ('ai_doc_check_enabled', 'true'),
    ('ai_scam_detection_enabled', 'true'),
    ('ai_translation_enabled', 'true'),
    ('ai_model', '"gpt-4o-mini"'),
    ('ai_temperature', '0.3'),
    ('ai_system_prompt', '""')
ON CONFLICT (key) DO NOTHING;

-- Down Migration
--
-- Drops only what is unambiguously this service's. The shared content tables
-- (knowledge_base, platform_settings, embedding_cache) are left alone: the web
-- platform reads them, and dropping them to roll back an API deploy would take
-- the knowledge base with it.
DROP INDEX IF EXISTS uq_ai_feedback_message_user;
