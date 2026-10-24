import postgres from "postgres";
import { config } from "./config.js";

export const sql = postgres(config.databaseUrl, {
  max: 10,
  onnotice: () => {},
  transform: { undefined: null },
});

const migrations: { id: string; sql: string }[] = [
  {
    id: "001_init",
    sql: `
CREATE TABLE admins (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tier: free | freemium | paid  (jenis provider)
CREATE TABLE providers (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT,
  api_key_env TEXT,
  requires_key BOOLEAN NOT NULL DEFAULT true,
  tier TEXT NOT NULL DEFAULT 'paid' CHECK (tier IN ('free','freemium','paid')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  extra_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  website TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tier: free | paid  (urutan fallback: free dulu, lalu paid)
CREATE TABLE ai_models (
  id SERIAL PRIMARY KEY,
  provider_id INT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  label TEXT,
  tier TEXT NOT NULL DEFAULT 'paid' CHECK (tier IN ('free','paid')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 100,
  temperature REAL NOT NULL DEFAULT 0.7,
  max_tokens INT NOT NULL DEFAULT 800,
  timeout_ms INT NOT NULL DEFAULT 30000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_id)
);

CREATE TABLE prompts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('assistant','cs','custom')),
  content TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX prompts_one_default ON prompts (is_default) WHERE is_default;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE contacts (
  id SERIAL PRIMARY KEY,
  wa_id TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- mode: ai (dibalas AI) | human (chat manual oleh admin)
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  contact_id INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'ai' CHECK (mode IN ('ai','human')),
  human_until TIMESTAMPTZ,
  prompt_id INT REFERENCES prompts(id) ON DELETE SET NULL,
  unread INT NOT NULL DEFAULT 0,
  needs_attention BOOLEAN NOT NULL DEFAULT false,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_inbound_at TIMESTAMPTZ,
  last_preview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, phone_number_id)
);
CREATE INDEX conversations_last_msg ON conversations (last_message_at DESC);

CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  sender TEXT NOT NULL CHECK (sender IN ('customer','ai','admin','system')),
  type TEXT NOT NULL DEFAULT 'text',
  body TEXT,
  media_url TEXT,
  wamid TEXT,
  kirim_msg_id TEXT,
  status TEXT,
  error TEXT,
  model_used TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX messages_in_wamid_uq ON messages (wamid) WHERE direction = 'in' AND wamid IS NOT NULL;
CREATE INDEX messages_wamid ON messages (wamid);
CREATE INDEX messages_kirim_id ON messages (kirim_msg_id);
CREATE INDEX messages_conv ON messages (conversation_id, id DESC);

CREATE TABLE ai_logs (
  id BIGSERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tier TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  latency_ms INT,
  prompt_tokens INT,
  completion_tokens INT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_logs_created ON ai_logs (created_at DESC);
`,
  },
  {
    id: "002_kirim_agent_sync",
    sql: `
ALTER TABLE conversations ADD COLUMN kirim_conversation_id TEXT;
CREATE INDEX conversations_kirim_id ON conversations (kirim_conversation_id);
-- asal pesan admin: 'panel' (admin panel ini) | 'kirimdev' (inbox/app Kirimdev)
ALTER TABLE messages ADD COLUMN source TEXT;
`,
  },
];

export async function migrate() {
  // advisory lock so api & worker starting together don't race
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(424242)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    const done = new Set((await tx`SELECT id FROM schema_migrations`).map((r) => r.id as string));
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      await tx.unsafe(m.sql);
      await tx`INSERT INTO schema_migrations (id) VALUES (${m.id})`;
      console.log(`[db] migration applied: ${m.id}`);
    }
  });
}
