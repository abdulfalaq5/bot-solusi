import { sql } from "../db.js";
import { DEFAULT_SETTINGS } from "../seed.js";

export type Settings = typeof DEFAULT_SETTINGS & {
  bot_enabled: boolean;
  bot_name: string;
  business_name: string;
  business_info: string;
  default_mode: "ai" | "human";
  history_limit: number;
  reply_debounce_ms: number;
  use_paid_fallback: boolean;
  max_attempts: number;
  fallback_message: string;
  handoff_keywords: string[];
  handoff_reply: string;
  human_auto_resume_minutes: number;
  mark_as_read: boolean;
  typing_indicator: boolean;
  reply_to_non_text: string;
  webhook_secrets: string[];
  takeover_on_open: boolean;
  sync_kirim_agent: boolean;
  human_delay_min_ms: number;
  human_delay_max_ms: number;
};

// Selalu dibaca dari DB (tanpa cache panjang) supaya perubahan di admin langsung berlaku.
let cache: { at: number; value: Settings } | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < 2000) return cache.value;
  const rows = await sql`SELECT key, value FROM settings`;
  const value = { ...DEFAULT_SETTINGS } as Settings;
  for (const r of rows) (value as any)[r.key] = r.value;
  cache = { at: Date.now(), value };
  return value;
}

export async function updateSettings(patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    await sql`INSERT INTO settings (key, value) VALUES (${key}, ${sql.json(value as any)})
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  }
  cache = null;
}
